import express from 'express';
import { DoltSysHandler } from '../dolt/doltSysHandler';
import { createDolthubDB, headToUrl } from '../dolt/doltAPI';
import { CalendarHandler } from '../calendar/CalendarHandler';
import { DoltHandler } from '../dolt/doltHandler';
import { dbOptions } from '../dolt/dbConfig';
import { dotPin } from '../storage/storageHandler';
import { checkSignature } from './helpers/signature';
import { ConfigSpaceRequest } from './models';
import { mergeTemplateConfig, mergeConfig, fetchTemplateCalendar, myProvider } from '../utils';
import logger from '../logging';
import { JuiceboxHandlerV3 } from '../juicebox/juiceboxHandlerV3';
import { getProjectDescription, getProjectName, getProjectAvatar } from './helpers/gpt';

const router = express.Router();

router.get('/', (_, res) => {
  res.send('nance-ish control panel');
});

// ================================ //
// ========= single config ======== //
// ================================ //

router.get('/config/:space', async (req, res) => {
  const { space } = req.params;
  const dolt = new DoltSysHandler();
  dolt.getSpaceConfig(space).then((doltConfig) => {
    if (doltConfig) { res.json({ success: true, data: doltConfig }); return; }
    res.json({ success: false, error: `config ${space} not found!` });
  }).catch((e) => {
    res.json({ success: false, error: e });
  });
});

// ================================ //
// ======== get all spaces ======== //
// ================================ //

router.get('/all', async (_, res) => {
  const doltSys = new DoltSysHandler();
  doltSys.getAllSpaceNames().then(async (data) => {
    const infos = await Promise.all(data.map(async (entry) => {
      const dolt = new DoltHandler(dbOptions(entry.config.dolt.repo), entry.config.propertyKeys);
      const calendar = new CalendarHandler(entry.calendar);
      const currentCycle = await dolt.getCurrentGovernanceCycle();
      const currentEvent = calendar.getCurrentEvent();
      const head = await dolt.getHead();
      return {
        name: entry.space,
        currentCycle,
        currentEvent,
        snapshotSpace: entry.config.snapshot.space,
        juiceboxProjectId: entry.config.juicebox.projectId,
        dolthubLink: headToUrl(entry.config.dolt.owner, entry.config.dolt.repo, head),
      };
    }));
    res.json({ success: true, data: infos });
  }).catch((e) => {
    res.json({ success: false, error: e });
  });
});

// ================================ //
// ========= config space ========= //
// ================================ //

router.post('/config', async (req, res) => {
  const { config, signature, calendar, owners } = req.body as ConfigSpaceRequest;
  const space = config.name;
  // signature must be valid
  const { valid } = checkSignature(signature, 'ish', 'config', { ...config, calendar, owners });
  if (!valid) { res.json({ success: false, error: '[NANCE ERROR]: bad signature' }); return; }

  // check if space exists and confiugurer is spaceOwner
  const dolt = new DoltSysHandler();
  const spaceConfig = await dolt.getSpaceConfig(space);
  if (spaceConfig && !spaceConfig.spaceOwners.includes(signature.address)) {
    res.json({ success: false, error: '[NANCE ERROR] configurer not spaceOwner!' });
    return;
  }

  // create space if it doesn't exist
  if (!spaceConfig) {
    dolt.createSpaceDB(space).then(async () => {
      await dolt.createSchema(space);
      await createDolthubDB(space);
      await dolt.localDolt.addRemote(`https://doltremoteapi.dolthub.com/nance/${space}`);
    }).catch((e) => { logger.error(`[CREATE SPACE]: ${e}`); });
  }

  // config the space
  const calendarIn = calendar || fetchTemplateCalendar();
  const configIn = (spaceConfig) ? mergeConfig(spaceConfig.config, config) : mergeTemplateConfig(config);
  const packedConfig = JSON.stringify({ signature, config: configIn, calendar: calendarIn });
  const cid = await dotPin(packedConfig);
  const ownersIn = [...(owners ?? []), signature.address];
  dolt.setSpaceConfig(space, cid, ownersIn, configIn, calendarIn).then(() => {
    res.json({ success: true, data: { space, spaceOwners: ownersIn } });
  }).catch((e) => {
    res.json({ success: false, error: e });
  });
});

router.get('/generate', async (req, res) => {
  const { owner } = req.query;
  const name = (await getProjectName())?.replaceAll('\n', '').replaceAll('.', '');
  const description = (await getProjectDescription())?.replaceAll('\n', '');
  const avatar = await getProjectAvatar(description);
  const avatarCID = await dotPin(avatar, 'base64');
  const metadata = {
    name,
    infoUri: '',
    logoUri: `ipfs://${avatarCID}`,
    coverImageUri: '',
    description,
    twitter: '',
    discord: '',
    telegram: '',
    tokens: [],
    tags: ['defi', 'nfts', 'art'],
    version: 8,
    payDisclosure: '',
  };
  const metadataCID = await dotPin(JSON.stringify(metadata));
  const juicebox = new JuiceboxHandlerV3('1', myProvider('goerli'), 'goerli');
  juicebox.launchProject(owner as string || '0x974957529c376F75647615407f3AeFDA12576D0E', metadataCID).then((data) => {
    res.json({ success: true, data });
  });
});

export default router;
