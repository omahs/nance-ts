import { CalendarHandler } from '../CalendarHandler';

const calendar = new CalendarHandler('./src/config/juicebox.ics');
// calendar.useIcsLinkInstead('https://raw.githubusercontent.com/jigglyjams/nance/main/tmp/juicebox.ics').then(() => {
//   console.log(calendar.getNextEvent());
// });
console.log(calendar.getNextEvent());