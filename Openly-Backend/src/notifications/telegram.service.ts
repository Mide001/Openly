import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";

@Injectable()
export class TelegramService {
    private readonly logger = new Logger(TelegramService.name);
    private readonly botToken: string;
    private readonly chatId: string;

    constructor(private readonly config: ConfigService, private http: HttpService) {
        this.botToken = this.config.get<string>("TELEGRAM_BOT_TOKEN")!;
        this.chatId = this.config.get<string>("TELEGRAM_CHAT_ID")!;
    }

    async sendMessage(message: string) {
        if (!this.botToken || !this.chatId) {
            this.logger.warn('Telegram credentials missing, skipping notification');
            return;
        }

        try {
            const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
            await firstValueFrom(this.http.post(url, {
                chat_id: this.chatId,
                text: message,
                parse_mode: "HTML",
            }));
        } catch (error) {
            this.logger.error('Failed to send telegram message: ', error.message);
        }
    }
}