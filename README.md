# Slack Message Cleanup Internal

사내 워크스페이스에서 본인이 삭제할 수 있는 Slack 메시지를 기간별로 미리 확인한 뒤 삭제하는 Windows 데스크톱 앱입니다.

## 사용자 흐름

1. 관리자가 제공한 Slack App Client ID를 입력합니다.
2. 브라우저에서 Slack 승인을 완료합니다.
3. 채널 또는 DM과 기간을 선택합니다.
4. 삭제 대상 미리보기를 확인합니다.
5. 체크박스와 삭제 건수 입력을 완료한 뒤 삭제합니다.

앱은 Client Secret이나 사용자 토큰을 화면에 요구하지 않습니다. Slack 토큰은 Electron `safeStorage`를 통해 사용자 PC의 Windows 보안 저장소로 암호화해 저장합니다.

## Slack 관리자 설정

1. Slack API에서 사내용 Custom App을 생성합니다.
2. `slack-app-manifest.json`을 가져옵니다.
3. OAuth & Permissions에서 PKCE가 켜져 있는지 확인합니다.
4. Redirect URL이 `http://127.0.0.1:52765/oauth/callback`인지 확인합니다.
5. 워크스페이스 정책에 따라 앱 설치 또는 사용자 승인을 허용합니다.
6. 사용자에게 Slack 앱의 Client ID만 전달합니다.

이 앱은 공개 Slack Marketplace 배포용이 아니라, 사내 승인 워크스페이스에서 쓰는 내부 도구입니다.

## 개발

```powershell
npm.cmd install
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run dev
```

프로덕션 빌드:

```powershell
npm.cmd run build
```
