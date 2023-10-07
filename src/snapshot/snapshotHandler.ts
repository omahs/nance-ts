import snapshot from '@snapshot-labs/snapshot.js';
import { request as gqlRequest, gql } from 'graphql-request';
import { ethers } from 'ethers';
import { Proposal, InternalVoteResults, SnapshotVoteOptions, NanceConfig } from '../types';
import { dateToUnixTimeStamp, myProvider, uuidGen } from '../utils';
import { STATUS } from '../constants';

export type SnapshotProposal = {
  id: string;
  type: string;
  start: string;
  choices: string[];
  votes: number;
  scores: number[];
  scores_total: number;
  title?: string;
  body?: string;
  author?: string;
  discussion?: string;
  ipfsCID?: string;
  state?: string;
};

type SnapshotVoteSettings = {
  quorum: number;
  period: number;
  type: string;
  delay: number;
};

const snapshotProposalToProposal = (sProposal: SnapshotProposal): Proposal => {
  let status = STATUS.VOTING;
  if (sProposal.state === 'closed') {
    status = sProposal.scores[0] > sProposal.scores[1] ? STATUS.APPROVED : STATUS.CANCELLED;
  }
  const proposalId = Number(sProposal.title?.match(/.*-(\d+)/)?.[1]) || null;
  return {
    hash: uuidGen(),
    title: sProposal.title || 'Title Unknown',
    body: sProposal.body || 'Body Unknown',
    status,
    authorAddress: sProposal.author,
    proposalId,
    createdTime: new Date(Number(sProposal.start) * 1000),
    discussionThreadURL: sProposal.discussion || '',
    ipfsURL: sProposal.ipfsCID || '',
    voteURL: sProposal.id,
    voteSetup: {
      type: sProposal.type,
      choices: sProposal.choices,
    },
    voteResults: {
      votes: sProposal.votes,
      scores: sProposal.scores,
      choices: sProposal.choices,
    }
  };
};

export class SnapshotHandler {
  private wallet;
  private provider;
  private hub;
  private snapshot;

  constructor(
    private privateKey: string,
    private config: NanceConfig
  ) {
    this.provider = myProvider('mainnet');
    this.wallet = (privateKey === '') ? ethers.Wallet.createRandom() : new ethers.Wallet(privateKey, this.provider);

    this.hub = 'https://hub.snapshot.org';
    this.snapshot = new snapshot.Client712(this.hub);
  }

  async createProposal(proposal: Proposal, startDate: Date, endDate: Date, options: SnapshotVoteOptions): Promise<string> {
    const startTimeStamp = dateToUnixTimeStamp(startDate);
    const endTimeStamp = dateToUnixTimeStamp(endDate);
    const latestBlock = await this.provider.getBlockNumber();
    const snapProposal = {
      space: this.config.snapshot.space,
      type: options.type,
      title: `${this.config.proposalIdPrefix}${proposal.proposalId} - ${proposal.title}`,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      body: proposal.body!,
      discussion: proposal.discussionThreadURL,
      choices: options.choices,
      start: startTimeStamp,
      end: endTimeStamp,
      snapshot: latestBlock,
      plugins: JSON.stringify({}),
    };
    const voteHash = await this.snapshot.proposal(this.wallet, this.wallet.address, snapProposal).then((response: any) => {
      return response.id;
    }).catch((e) => {
      return Promise.reject(e);
    });
    const voteURL = `${this.config.snapshot.base}/${this.config.snapshot.space}/proposal/${voteHash}`;
    return voteURL;
  }

  async getProposalVotes(proposalIds: string[]): Promise<InternalVoteResults[]> {
    const query = gql`
    {
      proposals (
        where: {
          space: "${this.config.snapshot.space}"
          id_in: [${proposalIds}]
        }
      ) {
        id
        choices
        type
        state
        scores_state
        votes
        scores
        scores_total
      }
    }`;
    const gqlResults = await gqlRequest(`${this.hub}/graphql`, query);
    const results = gqlResults.proposals.map((proposal: any) => {
      return {
        voteProposalId: proposal.id,
        totalVotes: proposal.votes,
        scoresState: proposal.scores_state,
        scoresTotal: proposal.scores_total,
        scores: proposal.choices.reduce((output: any, choice: string, index: number) => {
          return {
            ...output, [choice]: proposal.scores[index]
          };
        }, {})
      };
    });
    return results;
  }
  async getAllProposalsByScore(forSync = false): Promise<Proposal[]> {
    const query = gql`
    {
      proposals (
        where: {
          space: "${this.config.snapshot.space}"
        }
        first: 5
      ) {
        id
        votes
        type
        start
        state
        choices
        scores
        scores_total
        ${(forSync) ? 'title\nbody\nauthor\ndiscussion\nipfs' : ''}
      }
    }`;
    const gqlResults = await gqlRequest(`${this.hub}/graphql`, query);
    let results = gqlResults.proposals.sort((a: SnapshotProposal, b: SnapshotProposal) => {
      return b.scores_total - a.scores_total;
    });
    results = (forSync) ? results.map((result: SnapshotProposal) => { return snapshotProposalToProposal(result); }) : results;
    return results;
  }

  async getVotingSettings(): Promise<SnapshotVoteSettings> {
    const query = gql`
    {
      space(id: "${this.config.snapshot.space}") {
        voting {
          quorum
          period
          type
          delay
        }
      }
    }`;
    const results = await gqlRequest(`${this.hub}/graphql`, query);
    return results.space.voting;
  }
}
