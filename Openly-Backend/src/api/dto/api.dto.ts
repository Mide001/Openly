import { IsNotEmpty, IsNumber, IsOptional, IsString, IsObject, Min } from "class-validator";
import { Type } from "class-transformer";

export class CustomerDto {
    @IsOptional()
    @IsString()
    externalCustomerId?: string;

    @IsOptional()
    @IsString()
    firstName?: string;

    @IsOptional()
    @IsString()
    lastName?: string;

    @IsOptional()
    @IsString()
    email?: string;

    @IsOptional()
    @IsString()
    phoneNumber?: string;
}

export class InitializePaymentDto {
    @IsString()
    @IsNotEmpty()
    paymentRef: string;

    @IsNumber()
    @Min(0.5)
    amount: number;

    @IsOptional()
    @IsObject()
    @Type(() => CustomerDto)
    customer?: CustomerDto;

    @IsOptional()
    @IsObject()
    metadata?: any;
}

export class RequestPayoutDto {
    @IsNumber()
    @Min(10)
    amount: number;

    @IsOptional()
    @IsString()
    walletAddress?: string;
}

export class ConfigureWebhookDto {
    @IsString()
    @IsNotEmpty()
    url: string;

    @IsOptional()
    events?: string[];
}