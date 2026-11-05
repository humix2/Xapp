# XDeck — Tauri 試作版

Electron 版 XDeck（リポジトリ直下）を Tauri（Rust + WebView2）で作り直した**試作版**です。
軽さ・使い勝手を Electron 版と比べるためのもので、機能は一部だけ移植しています。
Electron 版のファイルには手を入れていません。

## 動かし方

前提: Rust（`rustup`）、Visual Studio の C++ ビルドツール、WebView2（Windows 11 は標準で入っています）。

```powershell
cd tauri/src-tauri
cargo run              # 開発用ビルドで起動
cargo build --release  # 配布用 → target/release/xdeck-tauri.exe
```

- 初回起動時、Electron 版のカラム設定（`%APPDATA%\xdeck\columns.json`）をコピーして使います。
  以降は Tauri 版専用の設定（`%APPDATA%\com.xdeck.tauri-prototype\columns.json`）に保存します。
- ログイン状態は Electron 版と共有されません。どれか 1 カラムで**ID/パスワードで**ログインしてください
  （Google/Apple ログインは別ウィンドウを使うため、試作版では動きません）。
- 開発用ビルドでは、カラムを右クリック →「検証」で開発者ツールを開けます。

## メモリ比較

両方を起動した状態で:

```powershell
pwsh tauri/scripts/measure-memory.ps1
```

アプリ本体＋ブラウザエンジンの子プロセスすべての合計を表示します。

## フォルダ構成

```text
tauri/
├── README.md            この説明
├── ui/                  アプリの外枠（ツールバー・カラムヘッダー）。HTML/CSS/JS
│   ├── index.html
│   ├── styles.css
│   ├── image-viewer.html / image-viewer.css   画像ビューアのウィンドウ
│   └── js/
│       ├── app.js           カラムの追加・削除・ボタン（入口）
│       ├── image-viewer.js  画像ビューア（前後切り替え・Esc で閉じる）
│       ├── api.js           Rust 側コマンドの呼び出し口（ここ以外で invoke しない）
│       ├── column-types.js  カラム種別ごとの URL・タイトル・⚙ の選択肢
│       ├── column-settings.js  ⚙ パネル（文字サイズ・自動更新・並び替え・検索演算子・表示）
│       ├── drag.js          カラムのドラッグ並べ替え・幅変更
│       ├── layout.js        カラムの位置を Rust に伝えて、X の画面を重ねる
│       └── diff-update.js   差分更新の手順と「新着あり」などの表示
├── page-scripts/        X のページの中で動かす JS（Rust がビルド時に埋め込む）
│   ├── on-load/             ページを開くたびに自動で実行
│   │   ├── apply-css.js         inject.css を適用
│   │   ├── column-settings.js   文字サイズ・ホームの表示（フォロー中/おすすめ）を適用
│   │   ├── block-autoplay.js    動画の自動再生を止める
│   │   ├── hide-ads.js          広告ポストを隠す
│   │   ├── photo-click.js       写真クリックで画像ビューアを開く
│   │   ├── hashtag-click.js     ハッシュタグクリックで右隣に検索カラムを開く
│   │   ├── forward-horizontal-wheel.js  カラム上の横ホイールでカラム一覧を横に動かす
│   │   └── compose-detect-post.js  （ポストウィンドウ専用）投稿成功を検知して閉じる
│   └── on-demand/           外枠から頼まれたときだけ実行（結果を返す）
│       ├── apply-column-settings.js  ⚙ の文字サイズ・表示の変更を反映
│       ├── diff-update.js       差分更新（新着の検出・取り込み）
│       ├── pending-settled.js   「新着あり」を消してよいかの判定
│       ├── scroll.js            ⤒ / ⤓
│       └── scroll-top-position.js
├── scripts/
│   └── measure-memory.ps1   メモリ比較
└── src-tauri/           Rust 側
    ├── Cargo.toml / build.rs / tauri.conf.json
    ├── capabilities/        どの画面がどのコマンドを呼べるか
    │   ├── shell.json           外枠: カラム操作のコマンド
    │   ├── x-pages.json         X のページ: 画像ビューア・ハッシュタグのカラム追加・カラム一覧の横スクロールだけ
    │   ├── image-viewer.json    画像ビューア: 自分を閉じることだけ
    │   └── compose.json         ポストウィンドウ: 投稿成功を知らせることだけ
    ├── icons/
    └── src/
        ├── main.rs          起動するだけ
        ├── lib.rs           ウィンドウと外枠を作る・コマンド登録・二重起動防止・ウィンドウ位置の保存
        ├── commands.rs      外枠から呼べるコマンドの一覧
        ├── columns.rs       カラムごとの X 用 WebView の作成・配置・削除
        ├── image_viewer.rs  画像ビューアのウィンドウ（twimg の画像 URL だけ受け付ける）
        ├── compose.rs       ポストウィンドウ（投稿成功で自動で閉じる）
        ├── fullscreen.rs    動画の全画面表示（そのカラムをウィンドウ全体に広げてフルスクリーンに）
        ├── navigation.rs    リンクをカラム内で開くか、ブラウザで開くか
        ├── page_scripts.rs  page-scripts/ の埋め込み
        ├── config.rs        columns.json の読み書き
        └── webview2.rs      WebView2 の開発者向け操作機能（フォーカス偽装・キー送信・JS 実行）
```

`inject.css` は Electron 版と同じファイル（リポジトリ直下）をそのまま使っています。

## 仕組み（Electron 版との違い）

| 項目 | Electron 版 | Tauri 版 |
| --- | --- | --- |
| カラムの X 画面 | `<webview>` タグ（DOM の一部） | ウィンドウ上に重ねたネイティブの WebView。外枠が位置を計算して Rust に伝える（`layout.js` → `columns.rs`） |
| ページ内 JS | preload + `executeJavaScript` | 初期化スクリプト（`on-load/`）+ DevTools Protocol の `Runtime.evaluate`（`on-demand/`） |
| フォーカス偽装・「.」キー | `webContents.debugger` | WebView2 の `CallDevToolsProtocolMethod`（`webview2.rs`） |
| ブラウザエンジン | Electron 同梱の Chromium | Windows 標準の WebView2（Edge） |
| 投稿成功の検知 | `webRequest.onCompleted` で通信を外から監視 | ページ内で XHR/fetch を包んで検知（`compose-detect-post.js`） |
| カラムの並べ替え・幅変更 | HTML のドラッグ＆ドロップ | X の画面の上ではドロップ先のイベントが来ないので、ポインターキャプチャ＋カラムの位置計算で判定（`drag.js`） |
| 文字サイズ | `insertCSS` で毎回差し込み | 初期化スクリプト＋ localStorage に保存（X がページを再読み込みしても維持） |
| 動画の全画面表示 | Electron がウィンドウ全体に広げる | WebView2 はカラムの枠内までしか広げないので、全画面の合図（`ContainsFullScreenElementChanged`）を受けて Rust が広げる（`fullscreen.rs`） |
| カラム上の横ホイール | `<webview>` から外側に自然に伝わる | 別の WebView なので伝わらない → ページ内で拾って Rust 経由で外枠に渡す（`forward-horizontal-wheel.js`） |

## 移植していない機能

- リロード調査用ログ（reload-debug.log）。Electron 版の GPU クラッシュ調査用なので、必要になったら入れる
