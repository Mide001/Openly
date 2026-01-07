import { Controller, Post, Get, Body, Param, Headers, UseGuards } from "@nestjs/common";
import { ApiService } from "./api.service";
import { ApiKeyGuard } from "./guards/api-key.guard";
import { InitializePaymentDto, RequestPayoutDto } from "./dto/api.dto";

@Controller("api/v1")
export class ApiController {
    constructor(private apiService: ApiService) { }

    @Post("payments/initialize")
    @UseGuards(ApiKeyGuard)
    async initializePayment(@Headers('x-api-key') apiKey: string, @Body() body: InitializePaymentDto) {
        return this.apiService.initializePayment(apiKey, body);
    }

    @Get("payments/:paymentRef/status")
    @UseGuards(ApiKeyGuard)
    async getPaymentStatus(@Headers('x-api-key') apiKey: string, @Param('paymentRef') paymentRef: string) {
        return this.apiService.getPaymentStatus(apiKey, paymentRef);
    }

    @Post("payouts/request")
    @UseGuards(ApiKeyGuard)
    async requestPayout(@Headers('x-api-key') apiKey: string, @Body() body: RequestPayoutDto) {
        return this.apiService.requestPayout(apiKey, body);
    }

    @Post("payouts")
    @UseGuards(ApiKeyGuard)
    async getPayoutHistory(@Headers('x-api-key') apiKey: string) {
        return this.apiService.getPayoutHistory(apiKey);
    }
}