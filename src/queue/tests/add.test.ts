/* eslint-disable @typescript-eslint/quotes */
/* eslint-disable quote-props */
import { DoltSysHandler } from '../../dolt/doltSysHandler';
import { getNextEvents } from '../../calendar/events';
import { DoltSQL } from '../../dolt/doltSQL';
import { dbOptions } from '../../dolt/dbConfig';
import { addEvents } from '../scheduler';
import { addSecondsToDate } from '../../utils';
import { EVENTS } from '../../constants';
import { DateEvent } from '../../types';

const now = new Date();
// const mockEvents: DateEvent[] = [
//   {
//     title: EVENTS.TEMPERATURE_CHECK,
//     start: addSecondsToDate(now, 60),
//     end: addSecondsToDate(now, 120)
//   },
//   {
//     title: EVENTS.SNAPSHOT_VOTE,
//     start: addSecondsToDate(now, 180),
//     end: addSecondsToDate(now, 240)
//   },
//   {
//     title: EVENTS.EXECUTION,
//     start: addSecondsToDate(now, 300),
//     end: addSecondsToDate(now, 360)
//   },
//   {
//     title: EVENTS.DELAY,
//     start: addSecondsToDate(now, 420),
//     end: addSecondsToDate(now, 480)
//   }
// ];

async function main() {
  const doltSys = new DoltSysHandler(new DoltSQL(dbOptions('nance_sys')));
  const config = await doltSys.getSpaceConfig('juicebox');
  // const mockTime = addSecondsToDate(now, 30);
  const events = getNextEvents(config.calendar, config.cycleStageLengths, now);
  console.log('events', events);
  // const mockTriggerTime = `${mockTime.getUTCHours()}:${mockTime.getUTCMinutes()}:${mockTime.getUTCSeconds()}`;
  // console.log('mockTriggerTime', mockTriggerTime);
  await addEvents(config.space, events, config.cycleTriggerTime);
}

main();
