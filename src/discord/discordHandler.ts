/* eslint-disable max-lines */
/* eslint-disable no-param-reassign */
import {
  Client as DiscordClient,
  Collection,
  User,
  GatewayIntentBits,
  Message,
  TextChannel,
  ThreadAutoArchiveDuration,
  EmbedBuilder,
  EmbedField,
  AttachmentBuilder,
} from 'discord.js';
import logger from '../logging';
import { limitLength, getLastSlash, DEFAULT_DASHBOARD, dateToUnixTimeStamp } from '../utils';
import { Proposal, PollResults, NanceConfig } from '../types';

import * as discordTemplates from './discordTemplates';
import { SQLPayout } from '../dolt/schema';
import { getENS } from '../api/helpers/ens';
import { EMOJI } from '../constants';

const SILENT_FLAG = 1 << 12;

export class DiscordHandler {
  private discord;
  private roleTag;
  private spaceURL: string;

  constructor(
    private config: NanceConfig
  ) {
    this.discord = new DiscordClient({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
      ]
    });
    this.discord.login(process.env[this.config.discord.API_KEY]).then(async () => {
      this.discord.on('ready', async (discord) => {
        logger.debug(`Ready! Logged in as ${discord.user.username}`);
      });
    }).catch((e) => {
      logger.error('discord auth failed!');
      logger.error(e);
    });
    this.roleTag = `<@&${this.config.discord.roles.governance}>`;
    this.spaceURL = `${DEFAULT_DASHBOARD}/s/${this.config.name}`;
  }

  ready() {
    return this.discord.isReady();
  }

  logout() {
    logger.info('logging out of discord');
    this.discord.destroy();
  }

  private getAlertChannel(): TextChannel {
    return this.discord.channels.cache.get(this.config.discord.channelIds.proposals) as TextChannel;
  }

  private getChannelById(id: string): TextChannel {
    return this.discord.channels.cache.get(id) as TextChannel;
  }

  private getDailyUpdateChannels(): TextChannel[] {
    const channels = [] as TextChannel[];
    this.config.discord.reminder.channelIds.forEach((channelId) => {
      try {
        this.discord.channels.cache.get(channelId);
        channels.push(this.discord.channels.cache.get(channelId) as TextChannel);
      } catch (e) {
        logger.error(`Could not get channel ${channelId} for space ${this.config.name}`);
      }
    });
    return channels;
  }

  async startDiscussion(proposal: Proposal): Promise<string> {
    const authorENS = await getENS(proposal.authorAddress);
    const message = discordTemplates.startDiscussionMessage(this.config.name, this.config.proposalIdPrefix, proposal, authorENS);
    const messageObj = await this.getAlertChannel().send({ embeds: [message] });
    const thread = await messageObj.startThread({
      name: limitLength(proposal.title),
      autoArchiveDuration: 24 * 60 * 7 as ThreadAutoArchiveDuration
    });
    return discordTemplates.threadToURL(thread);
  }

  async setupPoll(messageId: string) {
    const messageObj = await this.getAlertChannel().messages.fetch(messageId);
    await Promise.all([
      messageObj.react(EMOJI.YES),
      messageObj.react(EMOJI.NO),
    ]);
  }

  async sendTemperatureCheckRollup(proposals: Proposal[], endDate: Date) {
    const message = discordTemplates.temperatureCheckRollUpMessage(this.config.proposalIdPrefix, proposals, this.config.name, endDate);
    return this.getAlertChannel().send({ content: this.roleTag, embeds: [message] }).then((messageObj) => {
      return messageObj.id;
    });
  }

  async sendVoteRollup(proposals: Proposal[], endDate: Date) {
    const message = discordTemplates.voteRollUpMessage(
      this.spaceURL,
      this.config.proposalIdPrefix,
      proposals,
      this.config.name,
      endDate
    );
    const content = this.config.discord.roles.governance ? this.roleTag : undefined;
    return this.getAlertChannel().send({ content, embeds: [message] }).then((messageObj) => {
      return messageObj.id;
    });
  }

  async sendQuorumRollup(proposals: Proposal[], endDate: Date) {
    const message = discordTemplates.proposalsUnderQuorumMessage(this.spaceURL, this.config.proposalIdPrefix, proposals, this.config.snapshot.minTokenPassingAmount, this.config.name);
    return this.getAlertChannel().send(
      { content: `:hotsprings: ${this.roleTag} proposals under quorum! Voting ends at <t:${dateToUnixTimeStamp(endDate)}:f>(<t:${dateToUnixTimeStamp(endDate)}:R>) :hotsprings:`,
        embeds: [message]
      }).then((messageObj) => {
      return messageObj.id;
    });
  }

  async sendVoteResultsRollup(proposals: Proposal[]) {
    const message = discordTemplates.voteResultsRollUpMessage(
      this.spaceURL,
      this.config.name,
      this.config.proposalIdPrefix,
      proposals
    );
    return this.getAlertChannel().send({ content: this.roleTag, embeds: [message] }).then((messageObj) => {
      return messageObj.id;
    });
  }

  async editVoteResultsRollup(messageId: string, proposals: Proposal[]) {
    const messageObj = await this.getAlertChannel().messages.fetch(messageId);
    const message = discordTemplates.voteResultsRollUpMessage(
      this.spaceURL,
      this.config.name,
      this.config.proposalIdPrefix,
      proposals
    );
    messageObj.edit({ embeds: [message], flags: [SILENT_FLAG] });
  }

  async sendReminder(event: string, date: Date, type: string) {
    const message = (type === 'start')
      ? discordTemplates.reminderStartMessage(
        event,
        date,
      )
      : discordTemplates.reminderEndMessage(
        event,
        date,
      );
    return this.getAlertChannel().send({ content: this.roleTag, embeds: [message] }).then((messageObj) => {
      return messageObj.id;
    });
  }

  async sendDailyReminder(day: number, governanceCycle: number, type: string, endDate: Date, juiceboxTimeDelay?: number) {
    const endSeconds = endDate.getTime() / 1000;
    const link = this.spaceURL;
    const reminderType = this.config.discord.reminder.type;
    let message: EmbedBuilder;
    let attachments: AttachmentBuilder[];
    if (reminderType === 'image') {
      try {
        ({ message, attachments } = await discordTemplates.dailyImageReminder(day, this.config.discord.reminder.imagesCID, governanceCycle, type, link, endSeconds));
      } catch (e) {
        logger.error(`Could not send daily image reminder for ${this.config.name}`);
        logger.error(e);
        ({ message, attachments } = discordTemplates.dailyBasicReminder(governanceCycle, day, type, endSeconds, link));
      }
    } else if (reminderType === 'basic') {
      ({ message, attachments } = discordTemplates.dailyBasicReminder(governanceCycle, day, type, endSeconds, link));
    } else if (reminderType === 'juicebox') {
      ({ message, attachments } = discordTemplates.dailyJuiceboxBasedReminder(governanceCycle, day, endSeconds, juiceboxTimeDelay || (3 * 24 * 3600), link));
    } else { // default to basic
      ({ message, attachments } = discordTemplates.dailyBasicReminder(governanceCycle, day, type, endSeconds, link));
    }
    const channelsSent = await Promise.all(this.getDailyUpdateChannels().map(async (channel) => {
      if (!channel) return undefined as unknown as TextChannel;
      // delete old messages
      const messages = await channel.messages.fetch({ limit: 20 });
      const deletePromises = messages.filter((m) => {
        return m.author === this.discord.user && m.embeds[0]?.title === 'Governance Status';
      }).map((me) => { return me.delete(); });
      await Promise.all(deletePromises);
      try {
        channel.send({ embeds: [message], files: attachments, flags: [SILENT_FLAG] });
        return channel;
      } catch (e) {
        logger.error(`Could not send daily update to ${channel.name} for ${this.config.name}`);
        logger.error(e);
        return undefined as unknown as TextChannel;
      }
    }));
    if (channelsSent.includes(undefined as unknown as TextChannel)) {
      return Promise.reject(Error(`Could not send daily update to ${this.config.name}`));
    }
    return true;
  }

  private async getUserReactions(
    messageObj: Message,
    emoji: string
  ): Promise<{ verified: string[], unverified: string[] }> {
    // https://stackoverflow.com/questions/64241315/is-there-a-way-to-get-reactions-on-an-old-message-in-discordjs/64242640#64242640
    const pollReactionsCollection = messageObj.reactions.cache.get(emoji);
    let users: string[] = [];
    const unverified: string[] = [];
    // fetch members
    await this.discord.guilds.cache.get(this.config.discord.guildId)?.members.fetch();
    const { verifyRole } = this.config.discord.poll;
    if (pollReactionsCollection !== undefined) {
      users = await pollReactionsCollection.users.fetch()
        .then((results: Collection<string, User>) => {
          return results.filter((user): boolean => {
            if (!verifyRole) return !user.bot;
            const member = messageObj?.guild?.members.cache.get(user.id);
            if (!member) return false;
            const hasRole = member.roles.cache.has(verifyRole);
            if (!hasRole && !user.bot) unverified.push(user.username);
            return !user.bot && hasRole;
          }).map((user) => { return user.username; });
        });
    }
    return { verified: users, unverified };
  }

  async getPollVoters(messageId: string): Promise<PollResults> {
    const messageObj = await this.getAlertChannel().messages.fetch(messageId);
    const yesVoteUserList = await this.getUserReactions(
      messageObj,
      EMOJI.YES
    );
    const noVoteUserList = await this.getUserReactions(
      messageObj,
      EMOJI.NO
    );
    return {
      voteYesUsers: yesVoteUserList.verified,
      voteNoUsers: noVoteUserList.verified,
      unverifiedUsers: [...yesVoteUserList.unverified, ...noVoteUserList.unverified]
    };
  }

  async sendPollResults(pollResults: PollResults, outcome: boolean, threadId: string) {
    const message = discordTemplates.pollResultsMessage(
      pollResults,
      outcome,
      {
        voteYesEmoji: EMOJI.YES,
        voteNoEmoji: EMOJI.NO
      }
    );
    const sendChannel = this.getChannelById(threadId);
    await sendChannel.send({ embeds: [message] });
  }

  async sendPollResultsEmoji(pass: boolean, threadId: string) {
    const messageObj = await this.getAlertChannel().messages.fetch(threadId);
    if (pass) messageObj.react(EMOJI.VOTE);
    else messageObj.react(EMOJI.CANCELLED);
  }

  async setStatus() {
    this.discord.user?.setActivity(' ');
  }

  async editDiscussionTitle(proposal: Proposal) {
    const messageObj = await this.getAlertChannel().messages.fetch(getLastSlash(proposal.discussionThreadURL));
    const authorENS = await getENS(proposal.authorAddress);
    const message = discordTemplates.startDiscussionMessage(this.config.name, this.config.proposalIdPrefix, proposal, authorENS);
    if (messageObj.embeds[0].title !== message.data.title) {
      messageObj.edit({ embeds: [message] });
      messageObj.thread?.edit({ name: limitLength(proposal.title) });
    }
  }

  async editRollupMessage(proposals: Proposal[], status: string, messageId: string) {
    const messageObj = await this.getAlertChannel().messages.fetch(messageId);
    let message = new EmbedBuilder();
    if (status === 'temperatureCheck') { message = discordTemplates.temperatureCheckRollUpMessage(this.config.proposalIdPrefix, proposals, this.config.name, new Date()); }
    if (status === 'vote') {
      message = discordTemplates.voteRollUpMessage(
        `${DEFAULT_DASHBOARD}`,
        this.config.proposalIdPrefix,
        proposals,
        this.config.snapshot.space,
        new Date());
    }
    const editedMessage = messageObj.embeds[0];
    message.setTitle(editedMessage.title);
    message.setDescription(editedMessage.description);
    message.setURL(editedMessage.url);
    messageObj.edit({ embeds: [editedMessage] });
  }

  async sendPayoutsTable(payouts: SQLPayout[], governanceCycle: number) {
    const response = discordTemplates.payoutsTable(payouts, governanceCycle, this.config.name, this.config.proposalIdPrefix);
    await this.getChannelById(this.config.discord.channelIds.bookkeeping).send({ embeds: [response.message] });
  }

  async createTransactionThread(nonce: number, operation: string, oldDistributionLimit: number, newDistributionLimit: number, links: EmbedField[]) {
    const message = discordTemplates.transactionThread(nonce, operation, links);
    const thread = await this.getChannelById(this.config.discord.channelIds.transactions).send({ embeds: [message] }).then((messageObj) => {
      return messageObj.startThread({
        name: limitLength(message.data.title ?? 'thread'),
        autoArchiveDuration: 24 * 60 * 7 as ThreadAutoArchiveDuration
      });
    });
    return thread.id;
  }

  async editTransactionMessage(messageId: string, nonce: number, operation: string, links: EmbedField[]) {
    const messageObj = await this.getChannelById(this.config.discord.channelIds.transactions).messages.fetch(messageId);
    const editedMessage = messageObj.embeds[0];
    const message = discordTemplates.transactionThread(nonce, operation, links);
    // only edit description
    message.setTitle(editedMessage.title);
    message.setDescription(editedMessage.description);
    messageObj.edit({ embeds: [editedMessage] });
  }

  async sendTransactionSummary(threadId: string, addPayouts: SQLPayout[], removePayouts: SQLPayout[], oldDistributionLimit: number, newDistributionLimit: number) {
    const message1 = discordTemplates.transactionSummary(this.config.proposalIdPrefix, addPayouts);
    const message2 = discordTemplates.transactionSummary(this.config.proposalIdPrefix, undefined, removePayouts);
    const message3 = discordTemplates.transactionSummary(this.config.proposalIdPrefix, undefined, undefined, oldDistributionLimit, newDistributionLimit, undefined);

    await this.getChannelById(threadId).send({ embeds: [message3, message1, message2] });
  }

  async sendProposalDiff(threadId: string, diffText: string, hash: string) {
    const message = discordTemplates.proposalDiff(this.config.name, diffText, hash);
    await this.getChannelById(threadId).send(message);
  }

  async sendProposalArchive(proposal: Proposal) {
    const messageObj = await this.getAlertChannel().messages.fetch(getLastSlash(proposal.discussionThreadURL));
    const message = discordTemplates.archiveDiscussionMessage(proposal);
    // keep url the same
    message.setURL(messageObj.embeds[0].url);
    messageObj.edit({ embeds: [message] });
    messageObj.thread?.edit({ name: limitLength(proposal.title) });
    // send alert to thread
    const archiveMessage = discordTemplates.proposalArchiveAlert();
    await messageObj.thread?.send({ content: archiveMessage });
  }

  async sendProposalUnarchive(proposal: Proposal) {
    const messageObj = await this.getAlertChannel().messages.fetch(getLastSlash(proposal.discussionThreadURL));
    const authorENS = await getENS(proposal.authorAddress);
    const message = discordTemplates.startDiscussionMessage(this.config.name, this.config.proposalIdPrefix, proposal, authorENS);
    // keep url the same
    message.setURL(messageObj.embeds[0].url);
    messageObj.edit({ embeds: [message] });
    messageObj.thread?.edit({ name: limitLength(proposal.title) });
    // send alert to thread
    const archiveMessage = discordTemplates.proposalUnarchiveAlert();
    await messageObj.thread?.send({ content: archiveMessage });
  }

  async deleteMessage(messageId: string) {
    const messageObj = await this.getAlertChannel().messages.fetch(messageId);
    const res = await messageObj.delete();
    logger.info(`Deleted message ${messageId} with result ${res}`);
    return res;
  }

  async sendProposalDelete(proposal: Proposal) {
    const messageObj = await this.getAlertChannel().messages.fetch(getLastSlash(proposal.discussionThreadURL));
    const message = discordTemplates.deletedDiscussionMessage(proposal);
    // keep url the same
    message.setURL(messageObj.embeds[0].url);
    messageObj.edit({ embeds: [message] });
    messageObj.thread?.edit({ name: limitLength(proposal.title) });
    // send alert to thread
    const deleteMessage = discordTemplates.proposalDeleteAlert();
    // remove all reacts
    await messageObj.reactions.removeAll();
    await messageObj.thread?.send({ content: deleteMessage });
  }
}
