# Node.js SDK reference

Methods, inputs, and responses for integrating with the Raims public API.

| Service and method | HTTP operation | Input | Response |
| --- | --- | --- | --- |
| `accounts.retrieveFees` | `GET /v1/accounts/fees` | - | `AccountFees` |
| `accounts.retrieveNumber` | `GET /v1/accounts/account_number` | - | `AccountNumber` |
| `accounts.retrieveCheckoutSettings` | `GET /v1/accounts/checkout_settings` | - | `CheckoutSettings` |
| `accounts.updateCheckoutSettings` | `PATCH /v1/accounts/checkout_settings` | `UpdateCheckoutSettingsParams` | `CheckoutSettings` |
| `accounts.createCheckoutLogoUpload` | `POST /v1/accounts/checkout_settings/logo_uploads` | `CreateCheckoutLogoUploadParams` | `CheckoutAssetUpload` |
| `accounts.createCheckoutFaviconUpload` | `POST /v1/accounts/checkout_settings/favicon_uploads` | `CreateCheckoutFaviconUploadParams` | `CheckoutAssetUpload` |
| `accounts.deleteCheckoutAssetUpload` | `DELETE /v1/accounts/checkout_settings/uploads/{id}` | - | `CheckoutAssetUploadDeleted` |
| `accounts.retrieveContext` | `GET /v1/accounts/context` | - | `AccountContext` |
| `balances.retrieve` | `GET /v1/balances` | - | `Balance` |
| `balances.forecast` | `GET /v1/balances/forecast` | `GetBalanceForecastParams` | `BalanceForecast` |
| `charges.create` | `POST /v1/charges` | `CreateChargeParams` | `ChargeCreated` |
| `charges.list` | `GET /v1/charges` | `ListChargesParams` | `ChargeListResponse` |
| `charges.retrieve` | `GET /v1/charges/{id}` | - | `Charge` |
| `charges.update` | `PATCH /v1/charges/{id}` | `UpdateChargeParams` | `Charge` |
| `charges.revoke` | `DELETE /v1/charges/{id}` | - | `ChargeRevoked \| ChargeRevocationPending` |
| `charges.retrievePayment` | `GET /v1/charges/{id}/payment` | - | `PaymentReceipt` |
| `charges.retrieveReceipt` | `GET /v1/charges/{id}/receipt` | - | `FinancialDocument` |
| `charges.retrieveBoleto` | `GET /v1/charges/{id}/boleto` | - | `FinancialDocument` |
| `charges.createRefund` | `POST /v1/charges/{id}/refunds` | `CreateRefundParams` | `Refund` |
| `charges.listRefunds` | `GET /v1/charges/{id}/refunds` | `ListChargeRefundsParams` | `RefundListResponse` |
| `charges.retrieveRefundEligibility` | `GET /v1/charges/{id}/refund_eligibility` | - | `RefundEligibility` |
| `charges.statistics` | `GET /v1/charges/statistics` | `GetChargeStatisticsParams` | `ChargeStatistics` |
| `customers.create` | `POST /v1/customers` | `CreateCustomerParams` | `CustomerCreated` |
| `customers.list` | `GET /v1/customers` | `ListCustomersParams` | `CustomerListResponse` |
| `customers.retrieve` | `GET /v1/customers/{id}` | - | `CustomerListItem` |
| `customers.update` | `PATCH /v1/customers/{id}` | `UpdateCustomerParams` | `CustomerListItem` |
| `customers.delete` | `DELETE /v1/customers/{id}` | - | `CustomerDeleted` |
| `customers.deleteBatch` | `DELETE /v1/customers` | `DeleteCustomersBatchParams` | `CustomerBatchDeleted` |
| `disputes.list` | `GET /v1/disputes` | `ListDisputesParams` | `DisputeListResponse` |
| `disputes.retrieve` | `GET /v1/disputes/{id}` | - | `Dispute` |
| `paymentLinks.create` | `POST /v1/payment_links` | `CreatePaymentLinkParams` | `PaymentLink` |
| `paymentLinks.list` | `GET /v1/payment_links` | `ListPaymentLinksParams` | `PaymentLinkListResponse` |
| `paymentLinks.retrieve` | `GET /v1/payment_links/{id}` | - | `PaymentLinkDetails` |
| `paymentLinks.update` | `PATCH /v1/payment_links/{id}` | `UpdatePaymentLinkParams` | `PaymentLink` |
| `paymentLinks.sendEmail` | `POST /v1/payment_links/{id}/send_email` | - | `PaymentLinkEmailRequestAccepted` |
| `refunds.list` | `GET /v1/refunds` | `ListRefundsParams` | `RefundListResponse` |
| `refunds.retrieve` | `GET /v1/refunds/{id}` | - | `Refund` |
| `refunds.retrieveReceipt` | `GET /v1/refunds/{id}/receipt` | - | `FinancialDocument` |
| `statements.list` | `GET /v1/statements` | `ListStatementsParams` | `StatementListResponse` |
| `statements.retrieve` | `GET /v1/statements/{id}` | - | `Statement` |
| `webhookEventTypes.list` | `GET /v1/webhook_event_types` | - | `WebhookEventTypeListResponse` |
| `webhooks.create` | `POST /v1/webhooks` | `CreateWebhookParams` | `WebhookCreated` |
| `webhooks.list` | `GET /v1/webhooks` | `ListWebhooksParams` | `WebhookListResponse` |
| `webhooks.retrieve` | `GET /v1/webhooks/{webhook_id}` | - | `Webhook` |
| `webhooks.update` | `PATCH /v1/webhooks/{webhook_id}` | `UpdateWebhookParams` | `Webhook` |
| `webhooks.delete` | `DELETE /v1/webhooks/{webhook_id}` | - | `null` |
| `webhooks.retrieveHealth` | `GET /v1/webhooks/{webhook_id}/health` | - | `WebhookHealth` |
| `webhooks.setPause` | `PATCH /v1/webhooks/{webhook_id}/pause` | `SetWebhookPauseParams` | `WebhookPause` |
| `webhooks.rotateSecret` | `POST /v1/webhooks/{webhook_id}/rotate_secret` | `RotateWebhookSecretParams` | `WebhookSecretRotation` |
| `webhooks.test` | `POST /v1/webhooks/{webhook_id}/test` | - | `WebhookTestAccepted` |
| `withdrawalDestinations.list` | `GET /v1/withdrawal_destinations` | `ListWithdrawalDestinationsParams` | `WithdrawalDestinationListResponse` |
| `withdrawalDestinations.retrieve` | `GET /v1/withdrawal_destinations/{id}` | - | `WithdrawalDestination` |
| `withdrawals.create` | `POST /v1/withdrawals` | `CreateWithdrawalParams` | `Withdrawal` |
| `withdrawals.list` | `GET /v1/withdrawals` | `ListWithdrawalsParams` | `WithdrawalListResponse` |
| `withdrawals.retrieve` | `GET /v1/withdrawals/{id}` | - | `Withdrawal` |
| `withdrawals.retrieveLimits` | `GET /v1/withdrawals/limits` | - | `WithdrawalLimits` |
| `withdrawals.retrieveSummary` | `GET /v1/withdrawals/summary` | - | `WithdrawalSummary` |
| `withdrawals.retrieveAutomaticSettings` | `GET /v1/withdrawals/automatic_settings` | - | `AutomaticWithdrawalSettings` |
| `withdrawals.updateAutomaticSettings` | `PATCH /v1/withdrawals/automatic_settings` | `UpdateAutomaticWithdrawalSettingsParams` | `AutomaticWithdrawalSettings` |
| `simulations.charges.confirmPayment` | `POST /v1/simulations/charges/{id}/confirm_payment` | - | `ChargeSimulation` |
| `simulations.charges.failPayment` | `POST /v1/simulations/charges/{id}/fail_payment` | - | `ChargeSimulation` |
| `simulations.charges.configureScenario` | `POST /v1/simulations/charges/{id}/scenario` | `ConfigureSimulationScenarioParams` | `ChargeScenario` |
| `simulations.charges.resolveScenario` | `POST /v1/simulations/charges/{id}/resolve` | `ResolveSimulationScenarioParams` | `ChargeScenario` |
| `simulations.charges.issuePayment` | `POST /v1/simulations/charges/{id}/issue_payment` | `IssueSimulationPaymentParams` | `Charge` |
| `simulations.charges.compensateBoleto` | `POST /v1/simulations/charges/{id}/compensate_boleto` | - | `ChargeBoletoCompensation` |
| `simulations.charges.createRefund` | `POST /v1/simulations/charges/{id}/refunds` | `CreateSimulationRefundParams` | `Refund` |
| `simulations.refunds.complete` | `POST /v1/simulations/refunds/{id}/complete` | - | `Refund` |
| `simulations.refunds.fail` | `POST /v1/simulations/refunds/{id}/fail` | - | `Refund` |
