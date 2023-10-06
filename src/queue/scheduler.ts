import { AUTO, EVENTS, ONE_HOUR_SECONDS } from '../constants';
import { DateEvent } from '../types';
import { addSecondsToDate, dateAtTime } from '../utils';
import { queue } from './queue';

const formatJobTitle = (space: string, title: string, date: Date) => {
  return `${space}:${title}:${date.toISOString()}`;
};

const formatJob = (space: string, title: string, runDate: Date, dataDate?: Date) => {
  const name = formatJobTitle(space, title, runDate);
  return queue.createJob({ space, title, date: dataDate })
    .delayUntil(runDate)
    .setId(name)
    .retries(3)
    .backoff('exponential', 1000);
};

export const addEvents = async (space: string, events: DateEvent[], cycleTriggerTime: string) => {
  const now = new Date();
  const tommorrow = new Date(now.setUTCDate(now.getUTCDate() + 1));
  const dailyAlertTime = dateAtTime(tommorrow, cycleTriggerTime);
  const jobs = [formatJob(space, AUTO.dailyAlert, dailyAlertTime)];
  events.forEach((event) => {
    // =============================================
    // ============= TEMPERATURE CHECK =============
    // =============================================
    if (event.title === EVENTS.TEMPERATURE_CHECK) {
      jobs.push(
        // Temperature Check start alert
        formatJob(
          space,
          AUTO.temperatureCheckStartAlert,
          addSecondsToDate(event.start, -ONE_HOUR_SECONDS),
          event.start
        ),
        // Temperature Check rollup
        formatJob(
          space,
          AUTO.temperatureCheckRollup,
          event.start,
          event.start
        ),
        // Delete Temperature Check start alert
        formatJob(
          space,
          AUTO.deleteTemperatureCheckStartAlert,
          event.start
        )
      );
    }
    // =============================================
    // =============== SNAPSHOT VOTE ===============
    // =============================================
    if (event.title === EVENTS.SNAPSHOT_VOTE) {
      jobs.push(
        // Snapshot vote rollup
        formatJob(
          space,
          AUTO.voteRollup,
          event.start,
          event.start
        ),
        // Vote quorum alert
        formatJob(
          space,
          AUTO.voteQuorumAlert,
          addSecondsToDate(event.start, -2 * ONE_HOUR_SECONDS),
          event.end
        ),
        // Vote end alert
        formatJob(
          space,
          AUTO.voteEndAlert,
          addSecondsToDate(event.start, -ONE_HOUR_SECONDS),
          event.end
        ),
        // Delete vote end alert
        formatJob(
          space,
          AUTO.deleteVoteEndAlert,
          event.start
        ),
        // Vote close
        formatJob(
          space,
          AUTO.voteClose,
          event.end
        )
      );
    }
  });
  if (jobs) queue.saveAll(jobs);
};
