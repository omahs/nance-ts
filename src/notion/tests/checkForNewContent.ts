import { NotionHandler } from '../notionHandler';
import config from '../../config/dev/config.dev';
import { keys } from '../../keys';

if (keys.NOTION_KEY) {
  const notion = new NotionHandler(keys.NOTION_KEY, config);
  notion.getToDiscuss().then((r) => {
    console.log(r);
  });
}
