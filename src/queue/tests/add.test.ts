/* eslint-disable @typescript-eslint/quotes */
/* eslint-disable quote-props */
import { DoltSysHandler } from '../../dolt/doltSysHandler';
import { getNextEvents } from '../../calendar/events';
import { DoltSQL } from '../../dolt/doltSQL';
import { dbOptions } from '../../dolt/dbConfig';
import { addEvents } from '../scheduler';

async function main() {
  const doltSys = new DoltSysHandler(new DoltSQL(dbOptions('nance_sys')));
  const config = await doltSys.getSpaceConfig('waterbox');
  const events = getNextEvents(config.calendar, config.cycleStageLengths, new Date());
  console.log('events', events);
  await addEvents(config.space, events, config.cycleTriggerTime);
}

main();
