# Openly Backend API

Base URL: `http://localhost:3000/api/v1`

## Authentication (`/auth`)
Used for the Merchant Dashboard.

### Register
`POST /auth/register`
```json
{
  "businessEmail": "user@example.com",
  "businessName": "My Business",
  "password": "securepassword",
  "country": "NG",
  "walletAddress": "0x..."
}
```

### Login
`POST /auth/login`
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```
**Response:** Returns `accessToken` and `refreshToken`.

### Password Management
- **Forgot Password:** `POST /auth/forgot-password` (`{ "email": "..." }`)
- **Reset Password:** `POST /auth/reset-password` (`{ "token": "...", "newPassword": "..." }`)
- **Verify Email:** `GET /auth/verify-email?token=...`
- **Refresh Token:** `POST /auth/refresh` (Header: `Authorization: Bearer <refresh_token>`)

---

## Merchant API (`/`)
Used for Payment Integration. 
**Requires Header:** `x-api-key: <YOUR_API_KEY>`

### Initialize Payment
`POST /payments/initialize`
```json
{
  "paymentRef": "order_123",
  "amount": 10.50,
  "network": "TESTNET", // or MAINNET
  "customer": {
    "email": "customer@example.com",
    "firstName": "John",
    "lastName": "Doe"
  }
}
```
**Response:** Returns `paymentAddress` to send funds to.

### Check Status
`GET /payments/:paymentRef/status`
**Response:** `{ "status": "PENDING" | "CONFIRMING" | "COMPLETED", ... }`

### Payouts (Settlement)
- **Request Payout:** `POST /payouts/request`
  ```json
  { "amount": 100, "network": "TESTNET" }
  ```
- **History:** `GET /payouts`
