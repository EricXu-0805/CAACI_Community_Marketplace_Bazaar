# WeChat private photo handoff

## Implemented scope

Private chat photos now have a mini-program upload implementation behind the build flag `VITE_WECHAT_CHAT_PHOTOS_ENABLED=true` and server flag `WECHAT_CHAT_PHOTOS_ENABLED=true`. Both default off, independently of public-image moderation. H5 photo/video behavior stays available. No new database migration or public bucket is required.

- The client measures the compressed JPEG/PNG/GIF, caps it at 5 MiB and uploads to its existing private `chat-media` sender/conversation/message path. Unknown formats fail with a readable bilingual message. Session, metadata and upload operations have deadlines.
- The client awaits the durable WeChat safety handoff before creating the message. Cancellation/account changes never send an earlier user's photo. Failed and late uploads are cleaned using the initiating bearer; the existing Storage RLS prevents deletion of delivered objects and the orphan collector covers failed cleanup.
- The API accepts a private object key, never a client-supplied URL. It requires the authenticated sender's canonical key and asks Storage to sign it using the caller JWT/public key, so current object, conversation, block and account policies still apply. The service key cannot authorize signing. The exact project/path is checked again on the returned URL.
- WeChat receives a ten-minute capability to this one photo, with the server-resolved openid. The signed URL is neither returned to the client nor saved in the trace mapping. The mapping stores only the private path and owner, and must be durable before acknowledgment.
- Encrypted risky/review callbacks can remove only a canonical mapped photo belonging to its recorded owner. Storage's exact 400/Object-not-found response is accepted for idempotent retries; unrelated errors preserve the mapping and retry.

This is asynchronous moderation, not a claim of pre-approved imagery: a photo can be visible while the provider verdict is pending. Previously a `review` verdict just cleared the mapping without creating a review task. Both public and private image callbacks now remove `review` images as well as `risky` images; only `pass` retains the object. This conservative behavior is explicit because no staffed provider-review queue exists. It does not ban the sender or imply a completed human review.

## Release limits

Private videos are **not implemented for the mini program**. Do not route a video through `media_type: 2`, use only a thumbnail as proof of video moderation, expose the private bucket, or label the web video test as mini-program coverage. A real video classifier and its privacy/operational arrangement are still required for that feature.

Provider credentials, encrypted callback canary, published privacy disclosure, real device/account linking and platform review are independent gates. The build flag does not bypass any server gate. Do not upload the enabled diagnostic package as a public release before completing these gates.

## Validation

`api/_wechat-private-photo.test.mjs` covers sender/URL boundaries, caller-auth signing, third-party URL rejection, signing/mapping failure and encrypted callback deletion/retry. `app/smoke/mini-chat-photo.test.mjs` exercises the actual uploader with deterministic native callbacks: success ordering, silent upload timeout, late completion, account switch, moderation failure, size and format rejection. These use synthetic provider responses; they are not live WeChat acceptance.

The enabled feature branch is built and checked separately to ensure dead-code removal in the default-off package does not hide a compile error. Keep a release receipt for the exact uploaded bytes and version.

## Prepared privacy addition (publish before activation)

English: If you choose to send a photo in the WeChat mini program when this feature is available, we upload it to private storage and provide WeChat with a time-limited access link and your server-verified WeChat identifier for content safety checks. The link expires after ten minutes and is not made public. A rejected photo may be deleted. The check can finish after upload; it is not a guarantee that an attachment is safe. Sending text remains available without sending a photo.

中文：当微信小程序开放聊天照片功能后，若你选择发送照片，我们会将照片保存到私有存储，并向微信提供十分钟有效的访问链接及服务端确认的微信身份标识，用于内容安全检查。该链接不会公开展示。被判定违规的照片可能被删除；检查可能在上传后完成，并不保证附件绝对安全。你可以不发送照片而继续使用文字聊天。

This draft is not the currently published privacy policy. Activation must update both language documents, the consent version **and its database allowlist**, plus the actual platform privacy guide. Account-linking disclosure must also describe the optional control-proof flow, openid/unionid and short-lived hashed tickets. Do not change the version only in the frontend.
