import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional } from "class-validator";

export class RegisterMerchantDto {
    @IsEmail()
    @IsNotEmpty()
    businessEmail: string;

    @IsString()
    @IsNotEmpty()
    businessName: string;

    @IsString()
    @MinLength(8)
    password: string;

    @IsString()
    @IsNotEmpty()
    country: string;

    @IsString()
    @IsNotEmpty()
    walletAddress: string;
}

export class LoginMerchantDto {
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsString()
    @IsNotEmpty()
    password: string;
}

export class ForgotPasswordDto {
    @IsEmail()
    @IsNotEmpty()
    email: string;
}

export class ResetPasswordDto {
    @IsString()
    @IsNotEmpty()
    token: string;

    @IsString()
    @MinLength(8)
    newPassword: string;
}