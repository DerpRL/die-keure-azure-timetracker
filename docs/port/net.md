# Network port (`att-net`, `att_core::ticket_context`)

Swift sources: `API.swift` (all but `TrackingTransaction`, which `att_core::tracking` ports),
`SevenPaceAuth.swift`, `TicketContext.swift`; token persistence as used by
`PinPairingModel.swift` and its `SecretStore` extension.

| Swift | Rust |
|---|---|
| `Endpoint.sevenPace` / `Endpoint.azure` | `att_net::Endpoint::seven_pace` / `::azure` |
| `HTTPTransport`, `NoRedirectDelegate` | `att_net::HttpTransport`, `TransportOptions` |
| `SevenPaceAPI` (`authorization` closure) | `att_net::SevenPaceApi` + `Authorizer` (`BearerToken`, `SevenPaceTokenProvider`) |
| `AzureAPI` | `att_net::AzureApi` (+ new `work_items` batch) |
| `SevenPaceOAuth`, `SevenPacePIN`, `SevenPacePINStatus`, `SevenPaceTokens` | `SevenPaceOAuth`, `SevenPacePin`, `SevenPacePinStatus`, `SevenPaceTokens` |
| `SevenPaceTokenProvider` (actor), `persist` closure | `SevenPaceTokenProvider`, `PersistTokens` (closures implement it) |
| `TicketContext`, `TicketLink`, `PlainHTML.text` | `att_core::ticket_context::{TicketContext, TicketLink, plain_html::text}` |
| `SevenPaceAuthMode` | not here: belongs to `Configuration` in att-core (requested) |

## Test traceability

| Swift `File › Suite › test` | Rust `file::test` | Status |
|---|---|---|
| APITests › APITests › documentedStartAndStopContract | `api_tests::documented_start_and_stop_contract` | adapted: exact body; `timeZone` pinned (Brussels + fixed clock = 120) instead of `TimeZone.current` |
| APITests › APITests › currentExpandsAndValidates | `api_tests::current_expands_and_validates` | ported (+ exact query) |
| APITests › APITests › chosenActivityIsIncludedInStartRequest | `api_tests::chosen_activity_is_included_in_start_request` | ported (exact body) |
| APITests › APITests › standupRequestOmitsTicketAndSendsExactComment | `api_tests::standup_request_omits_ticket_and_sends_exact_comment` | ported (exact body) |
| APITests › APITests › figmaRequestOmitsTicketAndPreservesFileName | `api_tests::figma_request_omits_ticket_and_preserves_file_name` | ported |
| APITests › APITests › slackTokensUseOnlyAuthorizationHeadersAndErrorsAreRedacted | — | not ported: Slack is dead code |
| APITests › APITests › worklogsArePaginatedAndDeduplicated | `api_tests::worklogs_are_paginated_and_deduplicated` | ported (+ exact query, order, first copy wins) |
| APITests › APITests › rateLimitBlocksSubsequentRequests | `api_tests::rate_limit_blocks_subsequent_requests` | ported (+ exact block instant) |
| APITests › APITests › authErrorDoesNotExposeResponseBody | `api_tests::auth_error_does_not_expose_response_body` | ported |
| APITests › APITests › completionUsesTicketProjectAndWorkflowCategoryWithReadOnlyPATRequests | `api_tests::completion_uses_ticket_project_and_workflow_category_with_read_only_pat_requests` | adapted: organization URL is the mock server's `/example`; the path is asserted percent-encoded (wiremock reports the raw path, Swift `URL.path` is decoded) |
| APITests › APITests › completionRejectsWrongTicketWithoutFetchingStates | `api_tests::completion_rejects_wrong_ticket_without_fetching_states` | ported |
| APITests › APITests › completionDoesNotGuessWhenCategoriesAreUnknownOrForbidden | `api_tests::completion_does_not_guess_when_categories_are_unknown_or_forbidden` | ported (+ exact errors) |
| APITests › APITests › azureUsesPATAndEncodesProject | `api_tests::azure_uses_pat_and_encodes_project` | adapted: mock base URL (+ link) |
| APITests › APITests › pinCreationStatusAndExpiryUseDocumentedRequests | `api_tests::pin_creation_status_and_expiry_use_documented_requests` | ported |
| APITests › APITests › oauthExchangesSecretAndRotatesRefreshToken | `api_tests::oauth_exchanges_secret_and_rotates_refresh_token` | adapted: fixed clock, exact expiry instead of `> 3500 s` |
| APITests › APITests › oauthRefreshIsSharedAndPersistedBeforeRequests | `api_tests::oauth_refresh_is_shared_and_persisted_before_requests` | ported (refresh delayed so all 20 callers overlap it; each caller checks the write happened first) |
| APITests › APITests › persistenceFailureRetriesStorageWithoutRotatingAgain | `api_tests::persistence_failure_retries_storage_without_rotating_again` | ported |
| APITests › APITests › oauthTrackingWritesAreNotReplayedOnUnauthorizedResponse | `api_tests::oauth_tracking_writes_are_not_replayed_on_unauthorized_response` | ported |
| APITests › APITests › malformedPairingResponsesNeverExposeSecrets | `api_tests::malformed_pairing_responses_never_expose_secrets` | ported (`SevenPaceOAuth::for_workspace` is the throwing init) |
| APITests › APITests › slackHistoryRecoversOnlyHuddleMetadataAndPaginates | — | not ported: Slack is dead code |
| APITests › APITests › worklogReadRequestsEditabilityAndPatchOnlyChangesTime | `api_tests::worklog_read_requests_editability_and_patch_only_changes_time` | ported (exact PATCH body) |
| APITests › APITests › overlapHistoryHasNoLowerBoundThatCouldHideLongEntries | `api_tests::overlap_history_has_no_lower_bound_that_could_hide_long_entries` | ported (+ `$toTimestamp` = end + 1 s) |
| APITests › APITests › confirmingExpiredActivityPromptDoesNotSendWrite | `api_tests::confirming_expired_activity_prompt_does_not_send_write` | ported |
| APITests › APITests › activityConfirmationRechecksAndVerifiesContinuedTracking | `api_tests::activity_confirmation_rechecks_and_verifies_continued_tracking` | ported |
| APITests › APITests › mutationCRUDUsesDocumentedBodiesAndOnly404MeansAbsent | `api_tests::mutation_crud_uses_documented_bodies_and_only_404_means_absent` | adapted: the draft is written out field by field because `WorkLogDraft(log)` is ported with `att_core::worklog::ops`; exact bodies |
| APITests › APITests › azureContextRequestsRelationsAndUsesAzureAuthenticationOnly | `api_tests::azure_context_requests_relations_and_uses_azure_authentication_only` | adapted: mock base URL |
| CoreTests › DecodingTests › rejectsUnsafeEndpoints (5 cases) | `core_tests::rejects_unsafe_endpoints` | ported (one loop). CoreTests has no other Endpoint test. |
| WorkOperationsTests › WorkInsightTests › htmlAndTicketDetailsHandleIdentityFieldsAndRejectUnsafeLinks | att-core `ticket_context_tests::html_and_ticket_details_handle_identity_fields_and_reject_unsafe_links` | ported |

New tests (no Swift counterpart):

- `api_tests`: `work_items_are_read_in_batches_of_200_unique_ids`,
  `work_items_tolerate_odd_fields_and_skip_requests_without_ids`,
  `oauth_tokens_decode_the_1_14_keychain_item`, `token_provider_renews_only_in_the_last_minute`,
  `concurrent_callers_share_a_failed_renewal_and_the_next_call_retries`,
  `a_cancelled_caller_does_not_lose_rotated_tokens`.
- `transport_tests`: `retry_after_http_date_blocks_the_host_until_that_instant`,
  `missing_or_unreadable_retry_after_blocks_for_a_minute`,
  `the_429_block_covers_every_client_sharing_the_transport`,
  `redirects_are_refused_and_never_followed` (301/302/303/307/308),
  `statuses_map_to_errors_without_bodies`, `malformed_success_bodies_are_reported_without_their_content`,
  `delete_requires_a_json_object_like_swift`, `transport_failures_name_only_the_host`,
  `slow_responses_time_out`, `requests_identify_the_app_and_never_send_cookies`,
  `the_production_transport_refuses_plain_http_before_sending`,
  `invalid_worklog_ids_and_writes_never_reach_the_network`.
- `core_tests`: `rejects_every_other_unsafe_or_malformed_workspace_url_with_the_swift_message`,
  `accepts_workspace_urls_trimmed_on_the_default_port`, `azure_organizations_follow_the_swift_pattern`.
- att-core `ticket_context_tests`: field defaults, rejection of incomplete bodies, relation
  filtering and naming, the all-or-nothing relation cast, script/style, block and entity rules of
  `PlainHTML`, URI splitting, UI serialization.
- Unit tests: query/segment/form encoding (`wire`), `Retry-After` parsing (`transport`), token
  parsing and redacted `Debug` (`oauth`), worklog ID format (`seven_pace`).

## Decisions

1. **reqwest 0.13 features.** The workspace enables `rustls-no-provider`, `json` and `form`.
   att-net adds `system-proxy` (URLSession honoured OS proxy settings), `http2` and `gzip`
   (URLSession negotiated both). TLS is rustls with `rustls-platform-verifier`, so certificates
   are checked against the OS trust store, as before. The crypto provider is ring, installed as
   the process default when the transport is built (`install_crypto_provider`), the same provider
   `tauri-plugin-updater` installs. The app therefore has one provider, and no aws-lc C build,
   which would need NASM on Windows.
2. **No replays.** No request is retried by att-net. reqwest's default retry policy is kept: it
   re-sends only HTTP/2 requests the server refused unprocessed (`REFUSED_STREAM`, graceful
   `GOAWAY`; RFC 9113 §8.7), which cannot replay a write.
3. **Endpoint validation** runs on the text as typed with a strict RFC 3986 splitter
   (`att_core::ticket_context::UriParts`, URLComponents semantics), then re-checks the parsed
   `Url`. A WHATWG parser alone would accept `https:host`, drop an empty `user@`, or repair
   backslashes. Messages are verbatim.
4. **URLs.** Query items are encoded like `URLComponents.queryItems` (`$expand`, `:` and `,` stay
   readable; `& = + #` and spaces are escaped). Every project and work-item type name is one
   percent-encoded path segment; empty, `.` and `..` segments are refused (URL parsers would drop
   or resolve them).
5. **429 block** is keyed by host without port, as Swift, and shared by clones of one transport.
   `Retry-After` takes seconds (minimum 1) or an HTTP-date (IMF-fixdate via jiff's RFC 2822
   parser, which also accepts numeric offsets); otherwise 60 s. Non-finite seconds (`inf`) count
   as unreadable, so they cannot block a host until restart. Expired blocks are dropped.
6. **Errors.** Undecodable 2xx bodies use Foundation's text ("The data couldn’t be read because
   it isn’t in the correct format.") because serde messages can quote the payload. Transport
   failures say "Could not connect to {host}…" or "The connection to {host} was interrupted…";
   reqwest's own text is never used (it contains the URL with its query).
7. **`TransportOptions::https_only`** (default on) refuses non-HTTPS URLs before sending: defence
   in depth behind `Endpoint`. Tests on 127.0.0.1 turn it and proxies off.
8. **Authorizer** returns the whole header value (`Bearer …`); `BearerToken` and the token provider
   implement it. Secrets are sent as sensitive header values and are redacted from `Debug`.
9. **Time.** Clients hold a `Cal` for wire timestamps and an injectable `Clock` (default
   `Timestamp::now`) for `timeZone`, "no future time" checks, token expiry and 429 blocks. Rebuild
   `SevenPaceApi` when the user's zone changes.
10. **Write validation.** Swift's API called `WorkLogTimeEdit.validate()` / `WorkLogDraft.validate()`
    before every write. Those are being ported in `att_core::worklog::{edit, ops}` in parallel, so
    att-net carries private, message-identical copies (`seven_pace.rs`, marked `TODO(merge)`).
    Edits are re-rounded to whole seconds first, as Swift's initialiser guaranteed.
11. **DELETE** still requires a JSON object (content ignored), as Swift's empty `Decodable`; an
    empty 2xx body is reported as unreadable. Not loosened because 1.14.2 works against 7pace.
12. **Token provider.** A `tokio::sync::Mutex` guards the state for short sections only; the
    renewal runs as a spawned task (Swift's unstructured `Task`) and publishes its result on a
    `watch` channel, so concurrent callers share one refresh, one persist and, on failure, the
    same error; cancelling a caller cannot lose rotated tokens. Requires a Tokio runtime.
13. **Token storage format.** `SevenPaceTokens` reads the 1.14.x Keychain JSON (`expiresAt` as
    seconds since 2001) via `flex_date` and writes RFC 3339. `persist(next, previous)` should keep
    Swift's compare-and-swap (`renewOAuth`): write only while the stored item equals `previous`.
14. **Token parsing** is ported as is: `expires_in` number or numeric string (JSON booleans, which
    `NSNumber` accepted, are rejected), refresh token kept when absent or blank, `token_type`
    checked only when it is a string. The `{data: …}` envelope is tolerated for PIN endpoints only,
    as in Swift; `/token` takes a bare object.
15. **Batch titles.** `work_items` posts the specified body plus `"errorPolicy": "omit"`, so one
    deleted or unreadable ticket does not fail its chunk of 200 (Azure's default policy fails the
    whole request). `null` entries are skipped, IDs outside `1…i32::MAX` are dropped before the
    request, duplicates are removed, chunks run sequentially, odd field types fall back to
    `Work item #id`. Links use the configured project, like `work_item`.
16. **Ticket context.** `TicketLink.url` is a `String` (att-core has no URL crate). A relation URL
    with an empty host is dropped (Swift kept `https:///x`); an unparsable body yields "Azure
    returned incomplete ticket details." instead of Foundation's text. The HTML regexes are
    rewritten without `\b` and without the back-reference so they run on the linear-time engine;
    they match the same text (see the comment in `plain_html`). ICU `\s` is spelled
    `[\t\n\f\r\p{Z}]`.
17. **Small Swift rules kept on purpose:** `work_item` does not range-check the ID; one non-object
    relation drops every link; only lower-case `&#x` entities decode; `&amp;` decodes last, after
    numeric entities (so `&#38;lt;` becomes `<`); the configured project is used untrimmed and only
    when non-empty; the workflow state name is matched case-insensitively (`to_lowercase`, an
    approximation of `caseInsensitiveCompare`).
