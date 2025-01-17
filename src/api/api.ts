/* eslint-disable max-lines */
import express from 'express';
import { Contract } from 'ethers';
import { NanceTreasury } from '../treasury';
import logger from '../logging';
import { ProposalUploadRequest, FetchReconfigureRequest, EditPayoutsRequest, ProposalsPacket } from './models';
import { GnosisHandler } from '../gnosis/gnosisHandler';
import { getENS } from './helpers/ens';
import { getLastSlash, myProvider, sleep } from '../utils';
import { DoltHandler } from '../dolt/doltHandler';
import { DiscordHandler } from '../discord/discordHandler';
import { SQLPayout, SQLTransfer } from '../dolt/schema';
import { Proposal, GovernorProposeTransaction, BasicTransaction } from '../types';
import { diffBody } from './helpers/diff';
import { canEditProposal, isMultisig, isNanceAddress, isNanceSpaceOwner } from './helpers/permissions';
import { encodeCustomTransaction, encodeGnosisMulticall } from '../transactions/transactionHandler';
import { TenderlyHandler } from '../tenderly/tenderlyHandler';
import { addressFromJWT } from './helpers/auth';
import { DoltSysHandler } from '../dolt/doltSysHandler';
import { pools } from '../dolt/pools';
import { EVENTS, STATUS } from '../constants';
import { getSpaceInfo } from './helpers/getSpace';

const router = express.Router();
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const doltSys = new DoltSysHandler(pools.nance_sys);

async function handlerReq(query: string, auth: string | undefined) {
  try {
    const spaceInfo = await getSpaceInfo(query);
    const dolt = new DoltHandler(pools[query], spaceInfo.config.proposalIdPrefix);
    const jwt = auth?.split('Bearer ')[1];
    const address = (jwt && jwt !== 'null') ? await addressFromJWT(jwt) : null;
    return {
      spaceOwners: spaceInfo.spaceOwners,
      address,
      config: spaceInfo.config,
      currentGovernanceCycle: spaceInfo.currentCycle,
      currentEvent: spaceInfo.currentEvent,
      dolt,
      dolthubLink: spaceInfo.dolthubLink,
    };
  } catch (e) {
    logger.error(e);
    return Promise.reject(e);
  }
}

// ================================ //
// ======== info functions ======== //
// ================================ //
router.get('/:space', async (req, res) => {
  const { space } = req.params;
  const spaces = Object.keys(pools);
  if (!spaces.includes(space)) { return res.send({ success: false, error: `[NANCE ERROR]: space ${space} not found` }); }
  try {
    const { config, currentEvent, currentGovernanceCycle, dolthubLink, spaceOwners } = await handlerReq(space, req.headers.authorization);
    return res.send({
      sucess: true,
      data: {
        name: space,
        currentCycle: currentGovernanceCycle,
        currentEvent,
        spaceOwners,
        snapshotSpace: config.snapshot.space,
        juiceboxProjectId: config.juicebox.projectId,
        dolthubLink,
      }
    });
  } catch (e) {
    return res.send({ success: false, error: `[NANCE ERROR]: ${e}` });
  }
});

// ===================================== //
// ======== proposals functions ======== //
// ===================================== //

// query private proposals
router.get('/:space/privateProposals', async (req, res) => {
  const { space } = req.params;
  try {
    const { dolt, address } = await handlerReq(space, req.headers.authorization);
    const data: Proposal[] = [];

    // check for any private proposals
    if (address) {
      const privates = await dolt.getPrivateProposalsByAuthorAddress(address);
      data.push(...privates);
    }
    return res.send({ success: true, data });
  } catch (e) {
    return res.send({ success: false, error: `[NANCE] ${e}` });
  }
});

// query proposals
router.get('/:space/proposals', async (req, res) => {
  const { space } = req.params;
  try {
    const { cycle, keyword, author, limit, page } = req.query as { cycle: string, keyword: string, author: string, limit: string, page: string };
    const { dolt, config, currentEvent, currentGovernanceCycle } = await handlerReq(space, req.headers.authorization);
    const proposalIdPrefix = config.proposalIdPrefix.includes('-') ? config.proposalIdPrefix : `${config.proposalIdPrefix}-`;

    // calculate offset for SQL pagination
    const _limit = limit ? Number(limit) : 0;
    const _page = page ? Number(page) : 0;
    const _offset = _page ? (_page - 1) * _limit : 0;

    const cycleSearch = cycle || currentGovernanceCycle.toString();
    const { proposals, hasMore } = await dolt.getProposals({ governanceCycle: cycleSearch, keyword, author, limit: _limit, offset: _offset });

    const data: ProposalsPacket = {
      proposalInfo: {
        snapshotSpace: config.snapshot.space,
        proposalIdPrefix,
        minTokenPassingAmount: config.snapshot.minTokenPassingAmount,
      },
      proposals,
      hasMore,
    };

    if (cycle || currentEvent.title !== EVENTS.TEMPERATURE_CHECK || currentEvent.title !== EVENTS.DELAY) {
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=172800');
    }
    return res.send({ success: true, data });
  } catch (e) {
    return res.send({ success: false, error: `[NANCE] ${e}` });
  }
});

// upload new proposal
router.post('/:space/proposals', async (req, res) => {
  const { space } = req.params;
  const { proposal } = req.body as ProposalUploadRequest;
  try {
    const { config, dolt, address, currentGovernanceCycle } = await handlerReq(space, req.headers.authorization);
    if (!proposal) { res.json({ success: false, error: '[NANCE ERROR]: proposal object validation fail' }); return; }
    if (!address) { res.json({ success: false, error: '[NANCE ERROR]: missing SIWE adddress for proposal upload' }); return; }
    if (!proposal.governanceCycle) {
      proposal.governanceCycle = currentGovernanceCycle + 1;
    }
    if (!proposal.authorAddress) { proposal.authorAddress = address; }
    if (proposal.status === STATUS.ARCHIVED) { proposal.status = STATUS.DISCUSSION; } // proposal forked from an archive, set to discussion
    if (proposal.status === STATUS.PRIVATE) {
      dolt.addPrivateProposalToDb(proposal).then(async (hash: string) => {
        res.json({ success: true, data: { hash } });
      });
    } else {
      if (config.submitAsApproved) { proposal.status = STATUS.APPROVED; }
      console.log('======================================================');
      console.log('==================== NEW PROPOSAL ====================');
      console.log('======================================================');
      console.log(`space ${space}, author ${address}`);
      console.log(proposal);
      console.log('======================================================');
      console.log('======================================================');
      console.log('======================================================');
      dolt.addProposalToDb(proposal).then(async (hash: string) => {
        proposal.hash = hash;
        dolt.actionDirector(proposal);

        // send discord message
        const discordEnabled = config.discord.channelIds.proposals !== null;
        if ((proposal.status === STATUS.DISCUSSION || proposal.status === STATUS.APPROVED) && discordEnabled) {
          const dialogHandler = new DiscordHandler(config);
          // eslint-disable-next-line no-await-in-loop
          while (!dialogHandler.ready()) { await sleep(50); }
          try {
            const discussionThreadURL = await dialogHandler.startDiscussion(proposal);
            dialogHandler.setupPoll(getLastSlash(discussionThreadURL));
            dolt.updateDiscussionURL({ ...proposal, discussionThreadURL });
          } catch (e) {
            logger.error(`[DISCORD] ${e}`);
          }
        }
        res.json({ success: true, data: { hash } });
      }).catch((e: any) => {
        res.json({ success: false, error: `[DATABASE ERROR]: ${e}` });
      });
    }
  } catch (e) { res.json({ success: false, error: `[NANCE ERROR]: ${e}` }); }
});

// =========================================== //
// ======== single proposal functions ======== //
// =========================================== //

// get specific proposal by uuid, snapshotId, proposalId-#, or just proposalId #
router.get('/:space/proposal/:pid', async (req, res) => {
  const { space, pid } = req.params;
  const { dolt, address } = await handlerReq(space, req.headers.authorization);
  let proposal: Proposal;
  try {
    proposal = await dolt.getProposalByAnyId(pid);
    if (proposal.status !== STATUS.TEMPERATURE_CHECK || proposal.status !== STATUS.DISCUSSION) {
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=172800');
    }
    res.send({ success: true, data: proposal });
    return;
  } catch (e) {
    if (address) {
      try {
        proposal = await dolt.getPrivateProposal(pid, address);
        res.send({ success: true, data: proposal });
        return;
      } catch {
        res.send({ success: false, error: e });
        return;
      }
    }
  }
  res.send({ success: false, error: '[NANCE ERROR]: proposal not found' });
});

// edit single proposal
router.put('/:space/proposal/:pid', async (req, res) => {
  const { space, pid } = req.params;
  const { proposal } = req.body as ProposalUploadRequest;
  const { dolt, config, address, spaceOwners } = await handlerReq(space, req.headers.authorization);
  if (!address) { res.json({ success: false, error: '[NANCE ERROR]: missing SIWE adddress for proposal upload' }); return; }
  let proposalByUuid: Proposal;
  let isPrivate = false;
  try {
    proposalByUuid = await dolt.getProposalByAnyId(pid);
  } catch {
    proposalByUuid = await dolt.getPrivateProposal(pid, address);
    isPrivate = true;
  }
  if (!canEditProposal(proposalByUuid.status)) {
    res.json({ success: false, error: '[NANCE ERROR]: proposal edits no longer allowed' });
    return;
  }

  // only allow archives by original author, multisig, or spaceOwner
  const permissions = (
    address === proposalByUuid.authorAddress
    || await isMultisig(config.juicebox.gnosisSafeAddress, address)
    || isNanceSpaceOwner(spaceOwners, address)
    || isNanceAddress(address)
  );
  if (proposal.status === STATUS.ARCHIVED && !permissions) {
    res.json({ success: false, error: '[PERMISSIONS] User not authorized to archive proposal' });
    return;
  }

  proposal.authorAddress = proposalByUuid.authorAddress;
  proposal.coauthors = proposalByUuid.coauthors ?? [];
  proposal.governanceCycle = proposalByUuid.governanceCycle;
  if (address && !proposalByUuid.coauthors?.includes(address) && address !== proposalByUuid.authorAddress) {
    proposal.coauthors.push(address);
  }
  proposal.proposalId = (!proposalByUuid.proposalId && proposal.status === STATUS.DISCUSSION) ? await dolt.getNextProposalId() : proposalByUuid.proposalId;
  console.log('======================================================');
  console.log('=================== EDIT PROPOSAL ====================');
  console.log('======================================================');
  console.log(`space ${space}, author ${address}`);
  console.log(proposal);
  console.log('======================================================');
  console.log('======================================================');
  console.log('======================================================');
  const editFunction = (p: Proposal) => {
    if (isPrivate && (proposal.status === STATUS.DISCUSSION || proposal.status === STATUS.DRAFT)) return dolt.addProposalToDb(p);
    if (isPrivate) return dolt.editPrivateProposal(p);
    return dolt.editProposal(p);
  };
  const discord = new DiscordHandler(config);
  // eslint-disable-next-line no-await-in-loop
  while (!discord.ready()) { await sleep(50); }
  editFunction(proposal).then(async (hash: string) => {
    if (!isPrivate) dolt.actionDirector(proposal);
    if (isPrivate) dolt.deletePrivateProposal(hash);
    // if proposal moved form Draft to Discussion, send discord message
    const shouldCreateDiscussion = (
      (proposalByUuid.status === STATUS.DRAFT || proposalByUuid.status === STATUS.PRIVATE)
      && proposal.status === STATUS.DISCUSSION && !proposalByUuid.discussionThreadURL
    );
    if (shouldCreateDiscussion) {
      try {
        const discussionThreadURL = await discord.startDiscussion(proposal);
        await discord.setupPoll(getLastSlash(discussionThreadURL));
        await dolt.updateDiscussionURL({ ...proposal, discussionThreadURL });
      } catch (e) {
        logger.error(`[DISCORD] ${e}`);
      }
    }
    // archive alert
    if (proposal.status === STATUS.ARCHIVED) {
      try { await discord.sendProposalArchive(proposalByUuid); } catch (e) { logger.error(`[DISCORD] ${e}`); }
    }
    // unarchive alert
    if (proposal.status === STATUS.DISCUSSION && proposalByUuid.status === STATUS.ARCHIVED) {
      try { await discord.sendProposalUnarchive(proposalByUuid); } catch (e) { logger.error(`[DISCORD] ${e}`); }
    }

    // send diff to discord
    const diff = diffBody(proposalByUuid.body || '', proposal.body || '');
    if (proposalByUuid.discussionThreadURL && diff) {
      proposal.discussionThreadURL = proposalByUuid.discussionThreadURL;
      await discord.editDiscussionTitle(proposal);
      await discord.sendProposalDiff(getLastSlash(proposalByUuid.discussionThreadURL), diff, pid);
    }
    discord.logout();
    res.json({ success: true, data: { hash } });
  }).catch((e: any) => {
    res.json({ success: false, error: JSON.stringify(e) });
  });
});

// delete single proposal
router.delete('/:space/proposal/:hash', async (req, res) => {
  const { space, hash } = req.params;
  const { dolt, config, spaceOwners, address } = await handlerReq(space, req.headers.authorization);
  if (!address) { res.json({ success: false, error: '[NANCE ERROR]: missing SIWE adddress for proposal delete' }); return; }
  let proposalByUuid: Proposal;
  let isPrivate = false;
  try {
    proposalByUuid = await dolt.getProposalByAnyId(hash);
  } catch {
    try {
      proposalByUuid = await dolt.getPrivateProposal(hash, address);
      isPrivate = true;
    } catch { res.send({ success: false, error: '[NANCE ERROR]: proposal not found' }); return; }
  }
  if (!canEditProposal(proposalByUuid.status)) {
    res.json({ success: false, error: '[NANCE ERROR]: proposal edits no longer allowed' });
    return;
  }
  const permissions = (
    address === proposalByUuid.authorAddress
    || await isMultisig(config.juicebox.gnosisSafeAddress, address)
    || isNanceSpaceOwner(spaceOwners, address)
    || isNanceAddress(address)
  );
  const deleteFunction = (uuid: string) => { return isPrivate ? dolt.deletePrivateProposal(uuid) : dolt.deleteProposal(uuid); };
  if (permissions) {
    logger.info(`DELETE issued by ${address}`);
    deleteFunction(hash).then(async (affectedRows: number) => {
      const discord = new DiscordHandler(config);
      // eslint-disable-next-line no-await-in-loop
      while (!discord.ready()) { await sleep(50); }
      try { await discord.sendProposalDelete(proposalByUuid); } catch (e) { logger.error(`[DISCORD] ${e}`); }
      res.json({ success: true, data: { affectedRows } });
    }).catch((e: any) => {
      res.json({ success: false, error: e });
    });
  } else {
    res.json({ success: false, error: '[PERMISSIONS] User not authorized to delete proposal' });
  }
});

// ==================================== //
// ======== multisig functions ======== //
// ==================================== //

router.get('/:space/reconfigure', async (req, res) => {
  const { space } = req.params;
  const { version = 'V3', address = ZERO_ADDRESS, datetime = new Date() } = req.query as unknown as FetchReconfigureRequest;
  const { dolt, config, currentGovernanceCycle } = await handlerReq(space, req.headers.authorization);
  const ens = await getENS(address);
  const { gnosisSafeAddress, governorAddress, network } = config.juicebox;
  const treasury = new NanceTreasury(config, dolt, myProvider(config.juicebox.network), currentGovernanceCycle);
  const memo = `submitted by ${ens} at ${datetime} from juicetool & nance`;
  // *** governor reconfiguration *** //
  if (governorAddress && !gnosisSafeAddress) {
    const abi = await doltSys.getABI('NANCEGOV');
    return res.send(
      await treasury.fetchReconfiguration(version as string, memo).then((txn: BasicTransaction) => {
        const governorProposal: GovernorProposeTransaction = {
          targets: [txn.address],
          values: [0],
          calldatas: [txn.bytes],
          description: 'hi',
        };
        const contract = new Contract(governorAddress, abi);
        const encodedData = contract.interface.encodeFunctionData('propose', [governorProposal.targets, governorProposal.values, governorProposal.calldatas, governorProposal.description]);

        return { success: true, data: { governorProposal, governor: governorAddress, transaction: encodedData } };
      }).catch((e: any) => {
        return { success: false, error: e };
      })
    );
  }
  // *** gnosis reconfiguration *** //
  if (gnosisSafeAddress && !governorAddress) {
    const currentNonce = await GnosisHandler.getCurrentNonce(gnosisSafeAddress, network).then((nonce: string) => {
      return nonce;
    }).catch((e: any) => {
      return res.json({ success: false, error: e });
    });
    if (!currentNonce) { return res.json({ success: false, error: 'safe not found' }); }
    const nonce = (Number(currentNonce) + 1).toString();
    return res.send(
      await treasury.fetchReconfiguration(version as string, memo).then((txn: any) => {
        return { success: true, data: { safe: gnosisSafeAddress, transaction: txn, nonce } };
      }).catch((e: any) => {
        return { success: false, error: e };
      })
    );
  }
  return { success: false, error: 'no multisig or governor found' };
});

// ===================================== //
// ======== admin-ish functions ======== //
// ===================================== //

// check for changes to db, push to dolt if true
router.get('/:space/dolthub', async (req, res) => {
  const { space } = req.params;
  const { table } = req.query as { table: string | undefined };
  const { dolt, currentEvent, currentGovernanceCycle } = await handlerReq(space, req.headers.authorization);
  const message = `GC${currentGovernanceCycle}-${currentEvent.title}`;
  dolt.checkAndPush(table, message).then((data: string) => {
    return res.json({ success: true, data });
  }).catch((e: string) => {
    return res.json({ success: false, error: e });
  });
});

// create discussion and poll (used if it failed to automatically create)
router.get('/:space/discussion/:uuid', async (req, res) => {
  const { space, uuid } = req.params;
  const { config, dolt } = await handlerReq(space, req.headers.authorization);
  const proposal = await dolt.getProposalByAnyId(uuid);
  let discussionThreadURL = '';
  if (proposal.status === STATUS.DISCUSSION && !proposal.discussionThreadURL) {
    const dialogHandler = new DiscordHandler(config);
    // eslint-disable-next-line no-await-in-loop
    while (!dialogHandler.ready()) { await sleep(50); }
    try {
      discussionThreadURL = await dialogHandler.startDiscussion(proposal);
      await dialogHandler.setupPoll(getLastSlash(discussionThreadURL));
      await dolt.updateDiscussionURL({ ...proposal, discussionThreadURL });
    } catch (e) {
      logger.error(`[DISCORD] ${e}`);
    }
    return res.json({ success: true, data: discussionThreadURL });
  }
  return res.send({ success: false, error: 'proposal already has a discussion created' });
});

// ===================================== //
// ========= payout functions ========== //
// ===================================== //

// get payouts table
router.get('/:space/payouts', async (req, res) => {
  const { space } = req.params;
  try {
    const { cycle } = req.query as { cycle: string };
    const { dolt, currentGovernanceCycle } = await handlerReq(space, req.headers.authorization);

    if (!cycle) {
      dolt.getPayoutsDb(currentGovernanceCycle).then((data: SQLPayout[]) => {
        res.json({ success: true, data });
      }).catch((e: any) => {
        res.json({ success: false, error: e });
      });
    } else {
      dolt.getPreviousPayoutsDb('V3', Number(cycle)).then((data: SQLPayout[]) => {
        res.json({ success: true, data });
      }).catch((e: any) => {
        res.json({ success: false, error: e });
      });
    }
  } catch (e) {
    res.json({ success: false, error: e });
  }
});

// edit payouts table
router.put('/:space/payouts', async (req, res) => {
  const { space } = req.params;
  const { config, dolt, address, spaceOwners } = await handlerReq(space, req.headers.authorization);
  const { payouts } = req.body as EditPayoutsRequest;
  if (!address) { res.json({ success: false, error: '[NANCE ERROR]: missing SIWE adddress for proposal upload' }); return; }
  const safeAddress = config.juicebox.gnosisSafeAddress;
  if (await isMultisig(safeAddress, address) || isNanceAddress(address) || isNanceSpaceOwner(spaceOwners, address)) {
    logger.info(`EDIT PAYOUTS by ${address}`);
    dolt.bulkEditPayouts(payouts).then(() => {
      res.json({ success: true });
    }).catch((e: any) => { res.json({ success: false, error: e }); });
  } else { res.json({ success: false, error: '[PERMISSIONS] User not authorized to edit payouts' }); }
});

// ===================================== //
// ======== transfer functions ========= //
// ===================================== //

// get transfers table
router.get('/:space/transfers', async (req, res) => {
  const { space } = req.params;
  const { dolt, currentGovernanceCycle } = await handlerReq(space, req.headers.authorization);
  dolt.getTransfersDb(currentGovernanceCycle).then((data: SQLTransfer[]) => {
    res.json({ success: true, data });
  }).catch((e: any) => {
    res.json({ success: false, error: e });
  });
});

// basic simulation of a single customTransaction sent from the space gnosis safe
router.get('/:space/simulate/:uuid', async (req, res) => {
  try {
    const { space, uuid } = req.params;
    const { dolt, config } = await handlerReq(space, req.headers.authorization);
    const txn = await dolt.getTransactionsByUuids([uuid]);
    if (!txn || txn.length === 0) { res.json({ success: false, error: 'no transaction found' }); return; }
    const tenderly = new TenderlyHandler({ account: 'jigglyjams', project: 'nance' });
    const encodedTransaction = await encodeCustomTransaction(txn[0]);
    const from = config.juicebox.gnosisSafeAddress || config.juicebox.governorAddress;
    const tenderlyResults = await tenderly.simulate(encodedTransaction.bytes, encodedTransaction.address, from);
    res.json({ success: true, data: { ...tenderlyResults } });
  } catch (e) {
    res.json({ success: false, error: e });
  }
});

// tenderly simulation of multiple transactions, encoded using gnosis MultiCall
// pass in comma separated uuids of transactions to simulate as a query ex: ?uuids=uuid1,uuid2,uuid3...
router.get('/:space/simulateMulticall', async (req, res) => {
  try {
    const { space } = req.params;
    const { uuids, uuidOfProposal } = req.query as { uuids: string, uuidOfProposal: string };
    const { dolt, config } = await handlerReq(space, req.headers.authorization);
    const txn = (uuidOfProposal) ? await dolt.getTransactionsByProposalUuid(uuidOfProposal) : await dolt.getTransactionsByUuids(uuids.split(','));
    if (!txn || txn.length === 0) { res.json({ success: false, error: 'no transaction found' }); return; }
    const signer = (await GnosisHandler.getSigners(config.juicebox.gnosisSafeAddress))[0]; // get the first signer to encode MultiCall
    const encodedTransactions = await encodeGnosisMulticall(txn, signer);
    const tenderly = new TenderlyHandler({ account: 'jigglyjams', project: 'nance' });
    const tenderlyResults = await tenderly.simulate(encodedTransactions.data, config.juicebox.gnosisSafeAddress, signer, true);
    res.json({ success: true, data: { ...tenderlyResults, transactionCount: encodedTransactions.count, transactions: encodedTransactions.transactions } });
  } catch (e) {
    res.json({ success: false, error: e });
  }
});

export default router;
