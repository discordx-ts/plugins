import { Status } from "@discordx/lava-player";
import type { Player } from "@discordx/lava-queue";
import { Queue } from "@discordx/lava-queue";
import {
  Pagination,
  PaginationResolver,
  PaginationType,
} from "@discordx/pagination";
import type {
  CommandInteraction,
  ContextMenuCommandInteraction,
  DiscordAPIError,
  MessageActionRowComponentBuilder,
  StageChannel,
  TextBasedChannel,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Message,
} from "discord.js";

export class MusicQueue extends Queue {
  lastControlMessage?: Message;
  timeoutTimer?: NodeJS.Timeout;
  lockUpdate = false;
  channel?: Exclude<TextBasedChannel, StageChannel>;

  get isPlaying(): boolean {
    return this.lavaPlayer.status === Status.PLAYING;
  }

  constructor(player: Player, guildId: string) {
    super(player, guildId);
    setInterval(() => this.updateControlMessage(), 1e4);
  }

  private async deleteMessage(message: Message): Promise<void> {
    if (message.deletable) {
      // ignore any exceptions in delete action
      await message.delete().catch(() => null);
    }
  }

  private controlsRow(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const nextButton = new ButtonBuilder()
      .setLabel("Next")
      .setEmoji("⏭")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!this.isPlaying)
      .setCustomId("btn-next");

    const pauseButton = new ButtonBuilder()
      .setLabel(this.isPlaying ? "Pause" : "Resume")
      .setEmoji(this.isPlaying ? "⏸️" : "▶️")
      .setStyle(ButtonStyle.Primary)
      .setCustomId("btn-pause");

    const stopButton = new ButtonBuilder()
      .setLabel("Stop")
      .setStyle(ButtonStyle.Danger)
      .setCustomId("btn-leave");

    const repeatButton = new ButtonBuilder()
      .setLabel("Repeat")
      .setEmoji("🔂")
      .setDisabled(!this.isPlaying)
      .setStyle(this.repeat ? ButtonStyle.Danger : ButtonStyle.Primary)
      .setCustomId("btn-repeat");

    const loopButton = new ButtonBuilder()
      .setLabel("Loop")
      .setEmoji("🔁")
      .setDisabled(!this.isPlaying)
      .setStyle(this.loop ? ButtonStyle.Danger : ButtonStyle.Primary)
      .setCustomId("btn-loop");

    const row1 =
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        stopButton,
        pauseButton,
        nextButton,
        repeatButton
      );

    const queueButton = new ButtonBuilder()
      .setLabel("Queue")
      .setEmoji("🎵")
      .setStyle(ButtonStyle.Primary)
      .setCustomId("btn-queue");

    const mixButton = new ButtonBuilder()
      .setLabel("Shuffle")
      .setEmoji("🎛️")
      .setDisabled(!this.isPlaying)
      .setStyle(ButtonStyle.Primary)
      .setCustomId("btn-mix");

    const controlsButton = new ButtonBuilder()
      .setLabel("Controls")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Primary)
      .setCustomId("btn-controls");

    const row2 =
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        loopButton,
        queueButton,
        mixButton,
        controlsButton
      );
    return [row1, row2];
  }

  public async updateControlMessage(options?: {
    force?: boolean;
    text?: string;
  }): Promise<void> {
    if (this.lockUpdate) {
      return;
    }

    this.lockUpdate = true;
    const embed = new EmbedBuilder();
    embed.setTitle("Music Controls");
    const currentTrack = this.currentTrack;
    const nextTrack = this.nextTrack;

    if (!currentTrack) {
      if (this.lastControlMessage) {
        await this.deleteMessage(this.lastControlMessage);
        this.lastControlMessage = undefined;
      }

      this.lockUpdate = false;
      return;
    }

    embed.addFields({
      name:
        "Now Playing" +
        (this.size > 2 ? ` (Total: ${this.size} tracks queued)` : ""),
      value: `[${currentTrack.info.title}](${currentTrack.info.uri})`,
    });

    const progressBarOptions = {
      arrow: "🔘",
      block: "━",
      size: 15,
    };

    const { size, arrow, block } = progressBarOptions;
    const timeNow = this.position;
    const timeTotal = this.currentTrack?.info.length ?? 0;

    const progress = Math.round((size * timeNow) / timeTotal);
    const emptyProgress = size - (Number.isFinite(progress) ? progress : 0);

    const progressString =
      block.repeat(progress) + arrow + block.repeat(emptyProgress);

    const bar = (this.isPlaying ? "▶️" : "⏸️") + " " + progressString;
    const currentTime = this.fromMS(timeNow);

    let endTime: string;
    let spacing: number;
    if (currentTrack.info.isStream) {
      endTime = "Livestream";
      spacing = 8.5;
    } else {
      endTime = this.fromMS(timeTotal);
      spacing = bar.length - currentTime.length - endTime.length;
    }

    const time =
      "`" + currentTime + " ".repeat(spacing * 3 - 2) + endTime + "`";

    embed.addFields({ name: bar, value: time });

    embed.addFields({
      name: "Next Song",
      value: nextTrack
        ? `[${nextTrack.info.title}](${nextTrack.info.uri})`
        : "No upcoming song",
    });

    const pMsg = {
      components: [...this.controlsRow()],
      content: options?.text,
      embeds: [embed],
    };

    if (!this.lastControlMessage || options?.force) {
      if (this.lastControlMessage) {
        await this.deleteMessage(this.lastControlMessage);
        this.lastControlMessage = undefined;
      }

      const msg = await this.channel?.send(pMsg);
      if (msg) {
        this.lastControlMessage = msg;
      }
    } else {
      if (this.lastControlMessage.editable) {
        await this.lastControlMessage
          .edit(pMsg)
          .catch(async (err: DiscordAPIError) => {
            if (err.code === 10008) {
              // message is maybe deleted, try to resend new controls
              this.lastControlMessage = await this.channel?.send(pMsg);
            } else {
              throw err;
            }
          });
      }
    }

    this.lockUpdate = false;
  }

  public async view(
    interaction: CommandInteraction | ContextMenuCommandInteraction
  ): Promise<void> {
    if (!this.currentTrack) {
      const pMsg = await interaction.followUp({
        content:
          "> The queue could not be processed at the moment, please try again later!",
        ephemeral: true,
      });

      if (pMsg instanceof Message) {
        setTimeout(() => this.deleteMessage(pMsg), 3000);
      }
      return;
    }

    if (!this.size) {
      const pMsg = await interaction.followUp(
        `> Playing **${this.currentTrack.info.title}**`
      );
      if (pMsg instanceof Message) {
        setTimeout(() => this.deleteMessage(pMsg), 1e4);
      }
      return;
    }

    const current = `> Playing **[${this.currentTrack.info.title}](<${
      this.currentTrack.info.uri
    }>)** out of ${this.size + 1}`;

    const pageOptions = new PaginationResolver((index, paginator) => {
      paginator.maxLength = this.size / 10;
      if (index > paginator.maxLength) {
        paginator.currentPage = 0;
      }

      const currentPage = paginator.currentPage;

      const queue = this.tracks
        .slice(currentPage * 10, currentPage * 10 + 10)
        .map((track, index1) => {
          const endTime = track.info.isStream
            ? "Livestream"
            : this.fromMS(track.info.length);

          return (
            `${currentPage * 10 + index1 + 1}. [${track.info.title}](<${
              track.info.uri
            }>)` + ` (${endTime})`
          );
        })
        .join("\n\n");

      return { content: `${current}\n\n${queue}` };
    }, Math.round(this.size / 10));

    await new Pagination(interaction, pageOptions, {
      enableExit: true,
      onTimeout: (index, message) => {
        this.deleteMessage(message);
      },
      time: 6e4,
      type:
        Math.round(this.size / 10) <= 5
          ? PaginationType.Button
          : PaginationType.SelectMenu,
    }).send();
  }
}
