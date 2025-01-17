import { NanceConfig } from '../types';
import { discordLogin } from '../api/helpers/discord';
import { DoltHandler } from '../dolt/doltHandler';
import { pools } from '../dolt/pools';
import { doltSys } from '../dolt/doltSys';
import { TASKS } from '../constants';
import { DialogHandlerMessageIds } from '../dolt/schema';
import logger from '../logging';

export const voteRollup = async (config: NanceConfig, endDate: Date) => {
  try {
    const dialogHandler = await discordLogin(config);
    const dolt = new DoltHandler(pools[config.name], config.proposalIdPrefix);
    const proposals = await dolt.getVoteProposals({ uploadedToSnapshot: true });
    if (proposals.length === 0) return;
    const votingRollup = await dialogHandler.sendVoteRollup(
      proposals,
      endDate,
    );
    await doltSys.updateDialogHandlerMessageId(config.name, TASKS.voteRollup as keyof DialogHandlerMessageIds, votingRollup);
    dialogHandler.logout();
  } catch (e) {
    logger.error(`error rolling up vote for ${config.name}`);
    logger.error(e);
  }
};
