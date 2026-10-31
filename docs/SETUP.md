# 설치 가이드

이 문서를 위에서부터 순서대로 진행하면 자동 DM 서버가 동작합니다. 전체 소요 시간은 30~60분입니다.

각 단계에는 담당이 표시되어 있습니다.

- `👤 사람`: 브라우저에서 직접 클릭하거나 비밀번호를 입력해야 하는 단계입니다. AI 에이전트는 이 단계를 대신하지 말고 사용자에게 안내만 합니다.
- `🤖 에이전트`: 터미널 명령으로 할 수 있는 단계입니다. 사람이 직접 실행해도 됩니다.

> **AI 에이전트에게**: 시작 전에 [`AGENTS.md`](../AGENTS.md)의 규칙을 읽으세요. 토큰과 시크릿 값은 절대 출력하거나 채팅에 쓰지 않습니다.

---

## 1단계. Meta 앱 만들기 `👤 사람`

1. [developers.facebook.com](https://developers.facebook.com/apps) → **My Apps** → **Create App**을 누릅니다.
2. 앱 이름(아무거나, 나중에 변경 가능)과 연락 이메일을 넣고 **Next**를 누릅니다.
3. 사용 사례 화면 왼쪽 필터에서 **Business messaging**을 누르고, **Manage messaging & content on Instagram**에 체크한 뒤 **Next**를 누릅니다.
4. 비즈니스 포트폴리오 화면에서 **"I don't want to connect a business portfolio yet."** 을 고르고 **Next**를 누릅니다. 포트폴리오와 비즈니스 인증은 필요 없습니다.
5. "No requirements identified"가 보이면 **Next** → **Create app**을 누릅니다. 페이스북 비밀번호를 다시 물으면 입력합니다.
6. 대시보드에서 **Customize the Manage messaging & content on Instagram use case** → **API setup with Instagram login**으로 갑니다.
7. 1번 항목의 **Add all required permissions**를 누릅니다. "All required permissions added."가 나오면 됩니다.
   - 추가되는 권한: `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`
8. 왼쪽 메뉴 **App roles → Roles → Add** → **Instagram Tester**를 고르고 내 인스타그램 사용자 이름을 추가합니다.
   - "Form can't be saved" 오류가 나도 초대는 만들어집니다. 목록에 Pending이 보이면 됩니다.
9. 인스타그램 웹 [instagram.com/accounts/manage_access/](https://www.instagram.com/accounts/manage_access/) → **테스터 초대** 탭에서 초대를 수락합니다.

## 2단계. 개인정보처리방침과 앱 기본 설정 `👤 사람`

Publish 버튼은 이 항목이 모두 채워져야 눌립니다.

1. 개인정보처리방침 페이지를 공개 URL로 만듭니다. [템플릿](privacy-policy-template.md)을 고쳐서 블로그, 노션 공개 페이지, 내 사이트 등에 올리면 됩니다.
2. 왼쪽 메뉴 **App settings → Basic**에서 아래 값을 넣고 **Save Changes**를 누릅니다.

| 항목 | 값 |
| --- | --- |
| App domains | 개인정보처리방침 페이지의 도메인 (예: `example.com`) |
| Privacy policy URL | 1에서 만든 페이지 주소 |
| User data deletion | **Data deletion instructions URL**을 고르고 같은 페이지 주소 |
| Category | Business and pages |

앱 아이콘은 비워 두어도 됩니다.

## 3단계. 토큰과 앱 시크릿 받기 `👤 사람`

1. 저장소 폴더에서 `.env.example`을 `.env`로 복사합니다. (`🤖 에이전트`가 해도 됩니다: `cp .env.example .env`)
2. **API setup with Instagram login** 화면 맨 위의 **Instagram app secret** 옆 **Show**를 누르고, 값을 `.env`의 `IG_APP_SECRET=` 뒤에 붙여 넣습니다.
3. 2번 항목 **Generate access tokens**를 펼칩니다. 내 계정이 목록에 없으면 **Add account**를 누릅니다.
4. 내 계정 줄의 **Generate token**을 누릅니다. 팝업에서 **DM을 보낼 인스타그램 계정**으로 로그인하고 권한을 모두 허용합니다.
   - 팝업에서 로그인한 계정이 곧 자동 DM을 보내는 계정입니다. 다른 계정이 로그인되어 있지 않은지 확인하세요.
5. 표시된 토큰을 `.env`의 `IG_ACCESS_TOKEN=` 뒤에 붙여 넣고 저장합니다. 앞뒤 공백이 없어야 합니다.

> 토큰과 시크릿은 채팅, 스크린샷, git에 절대 넣지 마세요. AI 에이전트에게도 값을 알려 줄 필요가 없습니다. `.env` 파일에만 넣으면 됩니다.

**계정을 더 연결하려면**: 계정마다 1-8(테스터) → 3-4(토큰)를 반복하고, `.env`에 `IG_ACCESS_TOKEN_이름=토큰`을 추가합니다. `wrangler.toml`의 `AUTODM_EXTRA`에 그 이름을 쉼표로 적습니다. 예: `IG_ACCESS_TOKEN_SHOP` → `AUTODM_EXTRA = "SHOP"`.

## 4단계. 토큰 확인 `🤖 에이전트`

토큰 값을 출력하지 않고 확인합니다. 응답의 `username`이 DM을 보낼 계정인지 사용자에게 확인받습니다.

```bash
set -a; . ./.env; set +a
curl -s "https://graph.instagram.com/v23.0/me?fields=user_id,username,account_type&access_token=$IG_ACCESS_TOKEN"
```

`account_type`이 `BUSINESS` 또는 `MEDIA_CREATOR`여야 합니다.

## 5단계. Cloudflare에 배포 `🤖 에이전트` (로그인만 `👤 사람`)

1. 의존성을 설치합니다.
   ```bash
   npm install
   ```
2. Cloudflare에 로그인합니다. 브라우저가 열리면 `👤 사람`이 로그인하고 **Allow**를 누릅니다.
   ```bash
   npx wrangler login
   ```
3. D1 데이터베이스를 만들고 설정 파일을 준비합니다.
   ```bash
   npx wrangler d1 create autodm          # 출력의 database_id를 복사
   cp wrangler.example.toml wrangler.toml # database_id 칸에 붙여 넣기
   npx wrangler d1 execute autodm --remote --file schema.sql -y
   ```
   - 내 도메인(예: `autodm.example.com`)을 쓰려면 `wrangler.toml`의 `routes` 주석을 풉니다. 그 도메인이 같은 Cloudflare 계정에 있어야 합니다. 쓰지 않으면 `https://autodm.<내 서브도메인>.workers.dev` 주소가 생깁니다.
4. 관리 화면 비밀번호와 webhook verify token을 무작위로 만들어 `.env`에 넣습니다. 값은 출력하지 않습니다.
   ```bash
   grep -q '^ADMIN_PASSWORD=.' .env || sed -i.bak "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=')|" .env
   grep -q '^AUTODM_VERIFY_TOKEN=.' .env || sed -i.bak "s|^AUTODM_VERIFY_TOKEN=.*|AUTODM_VERIFY_TOKEN=$(openssl rand -hex 16)|" .env
   rm -f .env.bak
   ```
5. 배포하고 시크릿을 등록합니다.
   ```bash
   npx wrangler deploy                 # 출력의 Worker 주소를 기록
   ./scripts/push-secrets.sh           # ok IG_ACCESS_TOKEN ... 이 나오면 성공
   ```
6. 동작을 확인합니다. `U`에는 5에서 기록한 주소를 넣습니다.
   ```bash
   U=https://autodm.example.workers.dev
   set -a; . ./.env; set +a
   curl -s -o /dev/null -w '%{http_code}\n' $U/api/state                               # 401
   curl -s -u "a:$ADMIN_PASSWORD" $U/api/state | head -c 200; echo                      # accounts에 내 계정
   curl -s "$U/webhook?hub.mode=subscribe&hub.verify_token=$AUTODM_VERIFY_TOKEN&hub.challenge=42"; echo   # 42
   curl -s -o /dev/null -w '%{http_code}\n' -X POST -d '{}' $U/webhook                  # 403 (서명 없음)
   ```

## 6단계. webhook 연결

1. `👤 사람` **API setup with Instagram login** → 3번 항목 **Configure webhooks**에 아래 값을 넣고 **Verify and save**를 누릅니다.
   - Callback URL: `https://<Worker 주소>/webhook`
   - Verify token: `.env`의 `AUTODM_VERIFY_TOKEN` 값 (에이전트는 값을 채팅에 쓰지 말고, 사용자에게 `.env`에서 복사하도록 안내합니다)
2. `👤 사람` 아래 Webhook fields 표에서 `comments`, `messages`, `messaging_postbacks`가 **Subscribed**인지 확인합니다. 꺼져 있으면 켭니다.
3. `🤖 에이전트` 내 계정의 webhook 구독을 켭니다. (대시보드 2번 항목의 **Webhook Subscription** 토글과 같은 동작입니다.)
   ```bash
   set -a; . ./.env; set +a
   curl -s -X POST "https://graph.instagram.com/v23.0/me/subscribed_apps?subscribed_fields=comments,messages,messaging_postbacks&access_token=$IG_ACCESS_TOKEN"
   # {"success":true}
   ```

## 7단계. Publish `👤 사람`

**이 단계를 빼면 실제 댓글이 들어오지 않습니다.** 개발 모드에서는 webhook 연결이 성공해도 read·reaction 이벤트만 오고, 댓글과 DM 텍스트는 오지 않습니다.

1. 왼쪽 메뉴 **Publish**를 누릅니다.
2. "All required app settings are complete"를 확인합니다. 아니면 2단계로 돌아갑니다.
3. 오른쪽 아래 **Publish** 버튼을 누릅니다. "Your app was successfully published"가 나오면 됩니다.

Advanced Access 신청이나 앱 심사는 하지 않습니다. 화면의 "Complete app review" 항목은 무시합니다.

## 8단계. 자동화 만들기와 테스트 `👤 사람`

1. 브라우저에서 Worker 주소를 엽니다. 사용자 이름은 아무 값, 비밀번호는 `.env`의 `ADMIN_PASSWORD`입니다.
2. **+ 자동화 추가**를 누르고 게시물, 키워드, 첫 DM, 링크 DM을 정한 뒤 저장합니다.
3. **다른 인스타그램 계정**으로 그 게시물에 키워드 댓글을 답니다.
4. 첫 DM → **팔로우 확인 🙌** → 링크 DM 순서로 오는지 확인합니다.

`🤖 에이전트`는 테스트하는 동안 로그를 봅니다.

```bash
npx wrangler tail --format pretty
# [username] comment ... -> rule ...
# [username] check ... follows=true
```

---

## 체크리스트

- [ ] 인스타그램 계정이 프로페셔널(비즈니스/크리에이터) 계정이다
- [ ] Meta 앱을 만들고 권한 3개를 추가했다
- [ ] 내 인스타그램 계정을 Instagram Tester로 추가하고 수락했다
- [ ] 개인정보처리방침 URL이 공개되어 있고, App settings → Basic에 입력했다
- [ ] `.env`에 `IG_ACCESS_TOKEN`, `IG_APP_SECRET`을 넣었다 (채팅·git에 넣지 않았다)
- [ ] `/me` 응답의 `username`이 DM을 보낼 계정이다
- [ ] `wrangler.toml`에 `database_id`를 넣고 `schema.sql`을 실행했다
- [ ] `npx wrangler deploy`와 `./scripts/push-secrets.sh`가 성공했다
- [ ] 5-6의 확인 명령이 `401`, 내 계정, `42`, `403`을 돌려준다
- [ ] Callback URL이 `https://<Worker 주소>/webhook`이고 Verify and save에 성공했다
- [ ] `comments`, `messages`, `messaging_postbacks`가 Subscribed이다
- [ ] `subscribed_apps` 호출이 `{"success":true}`를 돌려줬다
- [ ] 앱이 **Published** 상태다
- [ ] 다른 계정으로 단 댓글에 첫 DM과 링크 DM이 왔다
- [ ] 같은 계정에서 다른 자동 DM 서비스를 껐다 (DM 중복 방지)
- [ ] 토큰 만료일(발급 후 60일)을 달력에 적었다

---

## 토큰 연장 (60일마다)

토큰은 발급 후 60일이 지나면 만료됩니다. 만료 전에 아래 명령을 실행하면 새 토큰을 받습니다. `🤖 에이전트`가 실행할 수 있습니다.

```bash
set -a; . ./.env; set +a
NEW=$(curl -s "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=$IG_ACCESS_TOKEN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
sed -i.bak "s|^IG_ACCESS_TOKEN=.*|IG_ACCESS_TOKEN=$NEW|" .env && rm .env.bak
./scripts/push-secrets.sh
```

이미 만료됐다면 3단계 4~5를 다시 하고 `./scripts/push-secrets.sh`를 실행합니다.

## 자주 막히는 지점

| 증상 | 원인과 해결 |
| --- | --- |
| webhook에 read·reaction만 오고 댓글이 안 옴 | 앱이 개발 모드입니다. 7단계 Publish를 합니다 |
| 댓글 webhook이 아예 안 옴 | `instagram_business_manage_comments` 권한, 6-2 필드 구독, 6-3 `subscribed_apps`를 확인합니다 |
| 대시보드의 Test 버튼은 오는데 실제 댓글은 안 옴 | Test는 개발 모드에서도 오는 샘플입니다. Publish를 확인합니다 |
| 로그에 `bad signature, dropped` | `IG_APP_SECRET`이 틀렸습니다. **Instagram app secret**(App settings의 App secret이 아님)인지 확인하고 `push-secrets.sh`를 다시 실행합니다 |
| 로그에 `token check failed` | 토큰이 만료됐거나 공백이 들어갔습니다. 3단계를 다시 합니다 |
| 내 댓글에 DM이 안 옴 | 정상입니다. 계정 주인이 단 댓글은 무시합니다. 다른 계정으로 테스트합니다 |
| 관리 화면에 게시물이 안 보임 | 토큰 계정에 게시물이 있는지, 토큰이 맞는지 확인합니다 |
| DM이 두 번 감 | 다른 자동 DM 서비스가 아직 켜져 있습니다 |
| Verify and save 실패 | Callback URL 끝이 `/webhook`인지, verify token이 `.env` 값과 같은지, 배포 후 `push-secrets.sh`를 실행했는지 확인합니다 |

## 참고 자료

- [Instagram API with Instagram Login: Webhooks](https://developers.facebook.com/docs/instagram-platform/webhooks)
- [Private Replies](https://developers.facebook.com/docs/instagram-platform/private-replies)
- [User Profile API (is_user_follow_business)](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile)
- [Instagram Platform overview (Standard/Advanced Access)](https://developers.facebook.com/docs/instagram-platform/overview)
- [Messenger Platform rate limits](https://developers.facebook.com/docs/messenger-platform/overview/rate-limiting)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
