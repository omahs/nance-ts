import { AUTO } from '../constants';
import { QueueJobData, connectQueue } from './queue';
import { getSpaceInfo } from '../api/helpers/getSpaceInfo';
import { deleteTemperatureCheckStartAlert, sendTemperatureCheckEndAlert, sendTemperatureCheckRollup, sendTemperatureCheckStartAlert } from '../actions/temperatureCheck';
import { deleteVoteEndAlert, sendQuorumRollup, sendVoteEndAlert, sendVoteResultsRollup, sendVoteRollup, voteClose, voteSetup } from '../actions/vote';
import { discordLogin } from '../api/helpers/discord';
import { incrementGovernanceCycle } from '../actions/governanceCycle';

const queue = connectQueue({ isWorker: true });

queue.on('ready', async () => {
  console.log('Queue is ready!');
});

queue.on('error', (err) => {
  console.log('Queue error:', err);
});

queue.on('failed', (job, err) => {
  console.log(`Job ${job.id} failed with error ${err.message}`);
});

queue.on('job progress', (job, progress) => {
  console.log(`Job ${job} reported progress: ${progress}%`);
});

queue.on('stalled', (job) => {
  console.log(`Job ${job} stalled`);
});

queue.checkStalledJobs(1000).then((stalledJobs) => {
  console.log('stalled jobs', stalledJobs);
});

queue.process(async (job) => {
  console.log(`========== Processing job ${job.id} ==========`);
  const { space, type, dataDate }: QueueJobData = job.data;

  const spaceInfo = await getSpaceInfo(space);
  const { config, currentCycle, currentDay, currentEvent, dialog } = spaceInfo;

  if (type === AUTO.dailyAlert) {
    console.log(`dailyAlert for ${space}`);
    const discord = await discordLogin(config);
    const success = await discord.sendDailyReminder(currentDay, currentCycle, currentEvent.title, currentEvent.end);
    return { success };
  }
  // =============================================
  // ============= TEMPERATURE CHECK =============
  // =============================================
  if (type === AUTO.incrementGovernanceCycle) {
    console.log(`${AUTO.incrementGovernanceCycle} for ${space}`);
    try {
      const success = await incrementGovernanceCycle(space);
      return { success };
    } catch (e) {
      console.log('incrementGovernanceCycle error', e);
      return { success: false, error: e };
    }
  }
  if (type === AUTO.temperatureCheckStartAlert) {
    console.log(`${AUTO.temperatureCheckStartAlert} for ${space}`);
    if (!dataDate) return { success: false, error: 'no dataDate' };
    try {
      const success = await sendTemperatureCheckStartAlert(config, dataDate);
      return { success };
    } catch (e) {
      console.log('temperatureCheckStartAlert error', e);
      return { success: false, error: e };
    }
  }
  if (type === AUTO.deleteTemperatureCheckStartAlert) {
    console.log(`${AUTO.deleteTemperatureCheckStartAlert} for ${space}`);
    try {
      const success = await deleteTemperatureCheckStartAlert(config, dialog.temperatureCheckStartAlert);
      return { success: true };
    } catch (e) {
      console.log('deleteTemperatureCheckStartAlert error', e);
      return { success: false, error: e };
    }
  }
  if (type === AUTO.temperatureCheckRollup) {
    console.log(`${AUTO.temperatureCheckRollup} for ${space}`);
    if (!dataDate) return { success: false, error: 'no dataDate' };
    try {
      const success = await sendTemperatureCheckRollup(config, dataDate);
      return { success };
    } catch (e) {
      console.log('temperatureCheckRollup error', e);
      return { success: false, error: e };
    }
  }
  if (type === AUTO.temperatureEndAlert) {
    console.log(`${AUTO.temperatureEndAlert} for ${space}`);
    if (!dataDate) return { success: false, error: 'no dataDate' };
    try {
      const success = await sendTemperatureCheckEndAlert(config, dataDate);
      return { success };
    } catch (e) {
      console.log('temperatureEndAlert error', e);
      return { success: false, error: e };
    }
  }
  if (type === AUTO.deleteTemperatureEndAlert) {
    console.log(`${AUTO.deleteTemperatureEndAlert} for ${space}`);
    try {
      const success = await deleteTemperatureCheckStartAlert(config, dialog.temperatureCheckEndAlert);
      return { success };
    } catch (e) {
      console.log('deleteTemperatureEndAlert error', e);
      return { success: false, error: e };
    }
  }
  // =============================================
  // =============== SNAPSHOT VOTE ===============
  // =============================================
  if (type === AUTO.voteSetup) {
    console.log(`${AUTO.voteSetup} for ${space}`);
    if (!dataDate) return { success: false, error: 'no dataDate' };
    try {
      const success = await voteSetup(config, dataDate);
      return { success };
    } catch (e) {
      console.log('voteSetup error', e);
      return { success: false, error: e };
    }
  }
  if (type === AUTO.voteRollup) {
    console.log(`${AUTO.voteRollup} for ${space}`);
    if (!dataDate) return { success: false, error: 'no dataDate' };
    try {
      const success = await sendVoteRollup(config, dataDate);
      return { success };
    } catch (e) {
      console.log('voteRollup error', e);
      return { success: false, error: e };
    }
  }
  if (type === AUTO.voteQuorumAlert) {
    console.log(`${AUTO.voteQuorumAlert} for ${space}`);
    if (!dataDate) return { success: false, error: 'no dataDate' };
    try {
      const success = await sendQuorumRollup(config, dataDate);
      return { success };
    } catch (e) {
      console.log('voteQuorumAlert error', e);
      return { success: false, error: e };
    }
  }
  if (type === AUTO.voteEndAlert) {
    console.log(`${AUTO.voteEndAlert} for ${space}`);
    if (!dataDate) return { success: false, error: 'no dataDate' };
    try {
      const success = await sendVoteEndAlert(config, dataDate);
      return { success };
    } catch (e) {
      console.log('voteEndAlert error', e);
      return { success: false, error: e };
    }
  }
  if (type === AUTO.deleteVoteEndAlert) {
    console.log(`${AUTO.deleteVoteEndAlert} for ${space}`);
    try {
      const success = await deleteVoteEndAlert(config, dialog.votingEndAlert);
      return { success };
    } catch (e) {
      console.log('deleteVoteEndAlert error', e);
      return { success: false, error: e };
    }
  }
  if (type === AUTO.voteClose) {
    console.log(`${AUTO.voteClose} for ${space}`);
    try {
      const success = await voteClose(config);
      return { success };
    } catch (e) {
      console.log('voteClose error', e);
      return { success: false, error: e };
    }
  }
  if (type === AUTO.voteResultsRollup) {
    console.log(`${AUTO.voteResultsRollup} for ${space}`);
    try {
      const success = await sendVoteResultsRollup(config, currentCycle);
      return { success };
    } catch (e) {
      console.log('voteResultsRollup error', e);
      return { success: false, error: e };
    }
  }
  console.log('==========================================');
  return { success: false, error: 'no type' };
});
