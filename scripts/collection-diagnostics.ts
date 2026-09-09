export type CollectionFailure =
  | "authentication" | "forbidden" | "throttled" | "billing-scope"
  | "unsupported" | "invalid-response" | "unknown";

/** The diagnostic is used only to select a constant; neither it nor the error object is published. */
export function classifyCollectionFailure(diagnostic: string): CollectionFailure {
  if (/TooManyRequests|throttl|(?:^|\D)429(?:\D|$)/i.test(diagnostic)) return "throttled";
  if (/AADSTS|AuthenticationFailed|InvalidAuthenticationToken|ExpiredAuthenticationToken|az login|not logged in|(?:^|\D)401(?:\D|$)/i.test(diagnostic)) return "authentication";
  if (/InvalidSubscriptionType|SubscriptionTypeNotSupported|BillingAccessDenied|billing.*(?:scope|account|not supported)|(?:scope|offer).*not supported/i.test(diagnostic)) return "billing-scope";
  if (/AuthorizationFailed|Forbidden|AccessDenied|does not have authorization|(?:^|\D)403(?:\D|$)/i.test(diagnostic)) return "forbidden";
  if (/InvalidApiVersion|NoRegisteredProviderFound|MissingSubscriptionRegistration|NotSupported|Unsupported/i.test(diagnostic)) return "unsupported";
  if (/not valid JSON|invalid response|response schema|pagination/i.test(diagnostic)) return "invalid-response";
  return "unknown";
}

const messages: Record<CollectionFailure, string> = {
  authentication: "認証に失敗しました。収集用 CLI のログインとトークンを確認してください。",
  forbidden: "読み取りが拒否されました。対象スコープのアクセス権を管理者に確認してください。",
  throttled: "要求数制限により収集できませんでした。時間を置いて再収集してください。",
  "billing-scope": "請求スコープまたは契約種別に関するエラーが返されました。請求管理者に確認してください。",
  unsupported: "API または対象機能が現在のスコープでサポートされない旨の応答でした。",
  "invalid-response": "応答形式またはページ継続を検証できなかったため、値を公開していません。",
  unknown: "読み取りに失敗しました。原因は特定できていません。応答の詳細は公開しません。"
};

export class CollectionError extends Error {
  constructor(readonly failure: CollectionFailure) {
    super(messages[failure]);
    this.name = "CollectionError";
  }
}

export function safeCollectionFailure(error: unknown): string {
  return messages[collectionFailureReason(error)];
}

export function collectionFailureReason(error: unknown): CollectionFailure {
  // Do not trust a structurally similar object or read an arbitrary exception's message.
  return error instanceof CollectionError && Object.hasOwn(messages, error.failure)
    ? error.failure : "unknown";
}
