import {
  Client as DiscordClient,
  Collection,
  User,
  Intents,
  Message,
  MessageEmbed,
  TextChannel,
  ThreadAutoArchiveDuration,
} from 'discord.js';
import logger from '../logging';
import { Proposal, PollResults } from '../types';

import * as discordTemplates from './discordTemplates';

export class DiscordHandler {
  private discord;

  constructor(
    discordKey: string,
    private config: any
  ) {
    this.discord = new DiscordClient({
      intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MESSAGE_REACTIONS
      ]
    });
    this.discord.login(discordKey).then(async () => {
      this.discord.on('ready', async (discord) => {
        logger.info(`Ready! Logged in as ${discord.user.username}`);
      });
    });
  }

  ready() {
    return this.discord.isReady();
  }

  private getAlertChannel(): TextChannel {
    return this.discord.channels.cache.get(this.config.discord.channelId) as TextChannel;
  }

  async sendEmbed(text: string, channelId: string): Promise<Message<boolean>> {
    const message = new MessageEmbed()
      .setTitle(text);
    const channel = this.discord.channels.cache.get(channelId) as TextChannel;
    const sentMessage = await channel.send({ embeds: [message] });
    return sentMessage;
  }

  async startDiscussion(toSend: Proposal): Promise<string> {
    const message = discordTemplates.startDiscussionMessage(toSend.category, toSend.url);
    const messageObj = await this.getAlertChannel().send(message);
    const thread = await messageObj.startThread({
      name: toSend.title,
      autoArchiveDuration: 24 * 60 * 7 as ThreadAutoArchiveDuration
    });
    return discordTemplates.threadToURL(thread);
  }

  async setupPoll(messageId: string) {
    const messageObj = await this.getAlertChannel().messages.fetch(messageId);
    if (this.discord.user) {
      if (messageObj.author.id === this.discord.user.id) {
        messageObj.edit(discordTemplates.setupPollMessage(messageObj));
      }
      await Promise.all([
        messageObj.react(this.config.discord.poll.voteYesEmoji),
        messageObj.react(this.config.discord.poll.voteNoEmoji)
      ]);
    }
  }

  async sendTemperatureCheckRollup(proposals: Proposal[], endTime: Date) {
    const message = discordTemplates.temperatureCheckRollUpMessage(proposals, endTime);
    await this.getAlertChannel().send(message);
  }

  private static async getUserReactions(
    messageObj: Message,
    emoji: string
  ): Promise<string[]> {
    // https://stackoverflow.com/questions/64241315/is-there-a-way-to-get-reactions-on-an-old-message-in-discordjs/64242640#64242640
    const pollReactionsCollection = messageObj.reactions.cache.get(emoji);
    if (pollReactionsCollection !== undefined) {
      const users = <string[]> await pollReactionsCollection.users.fetch()
        .then((results: Collection<string, User>) => {
          results.filter((user): boolean => { return !user.bot; })
            .map((user) => { return user.tag; });
        });
      return users;
    }
    return [''];
  }

  async closePoll(messageId: string): Promise<PollResults> {
    const messageObj = await this.getAlertChannel().messages.fetch(messageId);
    const yesVoteUserList = await DiscordHandler.getUserReactions(
      messageObj,
      this.config.discord.poll.voteYesEmoji
    );
    const noVoteUserList = await DiscordHandler.getUserReactions(
      messageObj,
      this.config.discord.poll.voteNoEmoji
    );
    return { voteYesUsers: yesVoteUserList, voteNoUsers: noVoteUserList };
  }

  async sendPollResults(pollResults: PollResults, threadId: string) {
    const message = discordTemplates.pollResultsMessage(
      pollResults,
      {
        voteYesEmoji: this.config.discord.poll.voteYesEmoji,
        voteNoEmoji: this.config.discord.poll.voteNoEmoji
      }
    );
    await this.discord.channels.cache.get(threadId).send({ embeds: [message] });
  }
}