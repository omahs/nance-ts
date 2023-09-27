import { discordLogin } from '../discord';
import { SpaceInfo } from '../../models';
import { EVENTS } from './constants';
import { DoltSysHandler } from '../../../dolt/doltSysHandler';
import { DoltHandler } from '../../../dolt/doltHandler';
import { pools } from '../../../dolt/pools';
import { getLastSlash } from '../../../utils';
import logger from '../../../logging';
import {
  shouldSendTemperatureCheckStartAlert,
  shouldDeleteTemperatureCheckStartAlert,
  shouldSendTemperatureCheckRollup,
  shouldSendTemperatureCheckEndAlert,
  shouldSendTemperatureCheckClose,
  shouldDeleteTemperatureCheckEndAlert,
} from './logic';

const doltSys = new DoltSysHandler(pools.nance_sys);

const pollPassCheck = (space: SpaceInfo, yesCount: number, noCount: number) => {
  const ratio = yesCount / (yesCount + noCount);
  if (yesCount >= space.config.discord.poll.minYesVotes
    && ratio >= space.config.discord.poll.yesNoRatio) {
    return true;
  }
  return false;
};

export const handleSendTemperatureCheckStartAlert = async (space: SpaceInfo) => {
  if (shouldSendTemperatureCheckStartAlert(space)) {
    const dialogHandler = await discordLogin(space.config);
    const temperatureCheckStartReminder = await dialogHandler.sendReminder(
      EVENTS.TEMPERATURE_CHECK,
      space.currentEvent.end,
      'start'
    );
    await doltSys.updateDialogHandlerMessageId(
      space.name,
      'temperatureCheckStartAlert',
      temperatureCheckStartReminder
    );
    dialogHandler.logout();
    return true;
  }
  return false;
};

export const handleDeleteTemperatureCheckStartAlert = async (space: SpaceInfo) => {
  if (shouldDeleteTemperatureCheckStartAlert(space)) {
    const dialogHandler = await discordLogin(space.config);
    await dialogHandler.deleteMessage(space.dialog.temperatureCheckStartAlert);
    await doltSys.updateDialogHandlerMessageId(space.name, 'temperatureCheckStartAlert', '');
    dialogHandler.logout();
    return true;
  }
  return false;
};

export const handleSendTemperatureCheckRollup = async (space: SpaceInfo) => {
  if (shouldSendTemperatureCheckRollup(space)) {
    const dialogHandler = await discordLogin(space.config);
    const dolt = new DoltHandler(pools[space.name], space.config.propertyKeys);
    const proposals = await dolt.getDiscussionProposals();
    const temperatureCheckRollup = await dialogHandler.sendTemperatureCheckRollup(
      proposals,
      space.currentEvent.end,
    );
    // TODO: update status of proposals to temperatureCheck
    await doltSys.updateDialogHandlerMessageId(space.name, 'temperatureCheckRollup', temperatureCheckRollup);
    dialogHandler.logout();
    return true;
  }
  return false;
};

export const handleSendTemperatureCheckEndAlert = async (space: SpaceInfo) => {
  if (shouldSendTemperatureCheckEndAlert(space)) {
    const dialogHandler = await discordLogin(space.config);
    const temperatureCheckEndReminder = await dialogHandler.sendReminder(
      EVENTS.TEMPERATURE_CHECK,
      space.currentEvent.end,
      'end'
    );
    await doltSys.updateDialogHandlerMessageId(
      space.name,
      'temperatureCheckEndAlert',
      temperatureCheckEndReminder
    );
    dialogHandler.logout();
    return true;
  }
  return false;
};

export const handleTemperatureCheckClose = async (space: SpaceInfo) => {
  if (shouldSendTemperatureCheckClose(space)) {
    const dolt = new DoltHandler(pools[space.name], space.config.propertyKeys);
    const dialogHandler = await discordLogin(space.config);
    const temperatureCheckProposals = await dolt.getTemperatureCheckProposals();
    await Promise.all(temperatureCheckProposals.map(async (proposal) => {
      const threadId = getLastSlash(proposal.discussionThreadURL);
      const pollResults = await dialogHandler.getPollVoters(threadId);
      const temperatureCheckVotes = [pollResults.voteYesUsers.length, pollResults.voteNoUsers.length];
      const pass = pollPassCheck(
        space,
        pollResults.voteYesUsers.length,
        pollResults.voteNoUsers.length
      );
      const status = (pass) ? space.config.propertyKeys.statusVoting : space.config.propertyKeys.statusCancelled;
      if (space.config.discord.poll.showResults) {
        dialogHandler.sendPollResults(pollResults, pass, threadId);
      }
      dialogHandler.sendPollResultsEmoji(pass, threadId);
      const updatedProposal = { ...proposal, status, temperatureCheckVotes };
      try { await dolt.updateTemperatureCheckClose(updatedProposal); } catch (e) { logger.error(`${space.name}: ${e}`); }
    })).then(() => {
      return true;
    }).catch((e) => {
      logger.error(`${space.name}: ${e}`);
      return false;
    });
  }
  return false;
};

export const handleDeleteTemperatureCheckEndAlert = async (space: SpaceInfo) => {
  if (shouldDeleteTemperatureCheckEndAlert(space)) {
    const dialogHandler = await discordLogin(space.config);
    await dialogHandler.deleteMessage(space.dialog.temperatureCheckEndAlert);
    await doltSys.updateDialogHandlerMessageId(space.name, 'temperatureCheckEndAlert', '');
    dialogHandler.logout();
    return true;
  }
  return false;
};
