# ⚾ 야구9단 매니저 (안드로이드 앱)

`../baseball9-web` 의 게임 페이지(HTML 한 파일)를 안드로이드 웹뷰로 감싼 앱입니다. 게임이 앱 안(`app/src/main/assets/index.html`)에 들어 있어 **인터넷 없이** 동작하고, 진행은 앱 데이터(localStorage)에 자동 저장됩니다.

## 설치 (휴대폰)
1. `app-debug.apk` 를 휴대폰으로 보냅니다 (카카오톡 나에게 보내기, 구글 드라이브, 메일 등).
2. 파일을 열면 **"출처를 알 수 없는 앱 설치"** 허용을 묻습니다. 허용 후 설치합니다.
3. Play 프로텍트가 "확인되지 않은 앱"이라고 경고하면 "설치"를 선택합니다 (개발용 디버그 서명이라 나오는 경고입니다).

안드로이드 7.0(API 24) 이상.

## 빌드
```bash
# 1) 게임 페이지를 최신으로 (baseball9-web 수정 후)
(cd ../baseball9-web && node build.js) && cp ../baseball9-web/dist/preview.html app/src/main/assets/index.html

# 2) APK 빌드 (Android SDK 34, JDK 17+, Gradle 8.9+ 필요)
echo "sdk.dir=/path/to/android-sdk" > local.properties
gradle assembleDebug            # → app/build/outputs/apk/debug/app-debug.apk
```

## 참고
- 디버그 키로 서명한 APK 입니다. Play 스토어에 올리려면 릴리스 키로 서명(`assembleRelease`)해야 합니다.
- 앱을 지우면 저장된 진행도 함께 지워집니다.
- 이 앱은 게임 로직을 JavaScript 로 돌리는 웹뷰 앱입니다 (서버 없음). Spring Boot 같은 서버는 쓰지 않습니다.
