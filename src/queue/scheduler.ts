import { AUTO, EVENTS, ONE_HOUR_SECONDS } from '../constants';
import { DateEvent } from '../types';
import { addSecondsToDate, dateAtTime } from '../utils';
import { QueueJobData, connectQueue } from './queue';

const queue = connectQueue({ isWorker: false });

const formatJobtype = (space: string, type: string, date: Date) => {
  return `${space}:${type}:${date.toISOString()}`;
};

const formatJob = ({ space, type, delayUntil, dataDate } : QueueJobData) => {
  const name = formatJobtype(space, type, delayUntil);
  return queue.createJob({ space, type, date: dataDate })
    .delayUntil(delayUntil)
    .setId(name)
    .retries(3)
    .backoff('exponential', 1000);
};

export const addEvents = async (space: string, events: DateEvent[], cycleTriggerTime: string) => {
  const now = new Date();
  let triggerTime = dateAtTime(now, cycleTriggerTime);
  console.log('daily trigger time', new Date(triggerTime.getTime()));
  if (now.getTime() > triggerTime.getTime()) {
    // set to tomorrow if triggerTime is in the past
    triggerTime = new Date(now.setUTCDate(now.getUTCDate() + 1));
  }
  const dailyAlertTime = dateAtTime(triggerTime, cycleTriggerTime);
  const jobs = [formatJob({ space, type: AUTO.dailyAlert, delayUntil: dailyAlertTime })];
  events.forEach((event) => {
    // =============================================
    // ============= TEMPERATURE CHECK =============
    // =============================================
    if (event.title === EVENTS.TEMPERATURE_CHECK) {
      jobs.push(
        // Increment currentGovernanceCycle
        formatJob({
          space,
          type: AUTO.incrementGovernanceCycle,
          delayUntil: addSecondsToDate(event.start, -5) // increment 5 seconds before Temperature Check start
        }),
        // Temperature Check start alert
        formatJob({
          space,
          type: AUTO.temperatureCheckStartAlert,
          delayUntil: addSecondsToDate(event.start, -ONE_HOUR_SECONDS),
          dataDate: event.start
        }),
        // Temperature Check rollup
        formatJob({
          space,
          type: AUTO.temperatureCheckRollup,
          delayUntil: event.start,
          dataDate: event.end
        }),
        // Delete Temperature Check start alert
        formatJob({
          space,
          type: AUTO.deleteTemperatureCheckStartAlert,
          delayUntil: event.start
        }),
        // Temperature Check end alert
        formatJob({
          space,
          type: AUTO.temperatureEndAlert,
          delayUntil: addSecondsToDate(event.end, -ONE_HOUR_SECONDS),
          dataDate: event.end
        }),
        // Delete Temperature Check end alert
        formatJob({
          space,
          type: AUTO.deleteTemperatureEndAlert,
          delayUntil: event.end
        }),
      );
    }
    // =============================================
    // =============== SNAPSHOT VOTE ===============
    // =============================================
    if (event.title === EVENTS.SNAPSHOT_VOTE) {
      jobs.push(
        // Vote setup
        formatJob({
          space,
          type: AUTO.voteSetup,
          delayUntil: event.start,
          dataDate: event.end
        }),
        // Snapshot vote rollup
        formatJob({
          space,
          type: AUTO.voteRollup,
          delayUntil: addSecondsToDate(event.start, 60),
          dataDate: event.end
        }),
        // Vote quorum alert
        formatJob({
          space,
          type: AUTO.voteQuorumAlert,
          delayUntil: addSecondsToDate(event.end, -2 * ONE_HOUR_SECONDS),
          dataDate: event.end
        }),
        // Vote end alert
        formatJob({
          space,
          type: AUTO.voteEndAlert,
          delayUntil: addSecondsToDate(event.end, -ONE_HOUR_SECONDS),
          dataDate: event.end
        }),
        // Delete vote end alert
        formatJob({
          space,
          type: AUTO.deleteVoteEndAlert,
          delayUntil: event.end
        }),
        // Vote close
        formatJob({
          space,
          type: AUTO.voteClose,
          delayUntil: event.end
        }),
        formatJob({
          space,
          type: AUTO.voteResultsRollup,
          delayUntil: addSecondsToDate(event.end, 60)
        })
      );
    }
  });
  if (jobs) queue.saveAll(jobs);
};
