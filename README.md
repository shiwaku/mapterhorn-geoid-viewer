# Mapterhorn ジオイドビューア

[Mapterhorn](https://mapterhorn.com/) の地形と [EGM2008](https://earth-info.nga.mil/) のジオイド面を、地球楕円体 (WGS 84) を基準に 3D で重ねて表示するビューアです。

```
標高 H  =  楕円体高 h  −  ジオイド高 N
```

- **地表面**: 楕円体高 h = Mapterhorn の標高 H + EGM2008 のジオイド高 N。MapLibre の地形として描き、背景地図 (OpenMapTiles スキーマのベクトルタイル) を貼ります。
- **ジオイド面**: EGM2008 のジオイド高 N。表し方は 2 通りです。
  - **色分け**: ジオイド高で色分けし、地形に隠れないよう半透明で重ねます。色の範囲は、いま画面に見えている範囲のジオイド高に合わせて伸縮します。
  - **水面**: ジオイドを水面として描き、地形との前後関係を判定します。海面がジオイドに沿うことが見え、水面を持ち上げると低い土地から沈みます。
  - 地表面を消すと不透明な立体になり、起伏を最大 10,000 倍まで強調できます。
- **等ジオイド高線**: ジオイド高の等値線とラベル。間隔 (0.5〜100 m) は表示範囲に合わせて変わります。
- MapLibre の globe 投影で、地球全体から地点の近くまで見られます。
- 地図をクリックすると、その地点の H・N・h を表示します。
- 地図で 2 点を選ぶと、その間の断面 (地表・ジオイド・地球楕円体) をグラフで表示します。縦軸はジオイド付近に絞ることもできます。
- スマホのホーム画面に追加して、アプリとして使えます (PWA)。

## 注意

Mapterhorn の標高の基準は地域によって異なります。日本は国土地理院の DEM (東京湾平均海面) で、その他の多くの地域は Copernicus GLO-30 (EGM2008) です。ジオイド高はすべて EGM2008 なので、日本の楕円体高には数十 cm 程度の誤差が出ることがあります。

## ジオイドの作成と表示のしくみ

ジオイドは「① タイルを作る (事前に 1 回)」「② ブラウザで読む」「③ 表示に使う」の 3 段階で扱います。

### ① タイルを作る (事前に 1 回)

`geoid/build_tiles.py` で、EGM2008 のグリッドをタイルにします。

1. 元データは、PROJ が配布する EGM2008 のジオイド高グリッド `us_nga_egm08_25.tif` です。2.5 分間隔 (日本付近で約 4 km) の格子に、WGS 84 楕円体からのジオイド高 N が入っています。
2. ズーム 0〜4 の 512 px タイルを作ります。各ピクセルの中心の N は、格子から双一次補間で求めます。ズーム 4 で、元の格子の間隔とほぼ同じ細かさになります。
3. 高さを Terrarium 形式 (`高さ = R × 256 + G + B / 256 − 32768`) で色に変え、WebP (可逆) で保存します。EGM2008 自体の精度は 10 cm 程度なので、高さは 1/64 m 単位に丸めてファイルを小さくしています。
4. 全タイルを PMTiles 形式の 1 ファイル `static/data/egm2008.pmtiles` (約 24 MB) にまとめます。

### ② ブラウザで読む

`src/lib/sources.ts` で読みます。

- `pmtiles` ライブラリで、PMTiles ファイルから必要なタイルだけを範囲リクエストで取ります。ファイル全体は読みません。
- タイル画像を色から高さに戻して高さの格子にし、キャッシュします。
- ズーム 5 以上の細かいタイルが要るときは、ズーム 4 の親タイルの該当部分を補間して使います。ジオイドはなめらかなので、これで足ります。

### ③ 表示に使う

| 使い道                    | やり方                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 地表面                    | Mapterhorn の標高 H に N を足して楕円体高 h = H + N のタイルを作り、MapLibre の地形として描きます。足し算は Web Worker (`ground.worker.ts`) で並列に行います。海の上は Mapterhorn にデータがないので H = 0 とし、地表面がジオイドと同じ高さになります。 |
| ジオイド面 (色分け・水面) | deck.gl で、タイルごとに 32 × 32 の格子のメッシュを作り、各頂点を高さ N (× 強調) に置きます (`layers.ts`)。globe 表示で面が地球の内側に沈まないよう、細かい格子にしています。色分けでは N で色を付け、水面では青一色で地形との前後関係を判定します。    |
| 等ジオイド高線            | 画面に見えているタイルの N の格子から、マーチングスクエア法で等値線を作ります (`contours.ts`)。地表面があるときは MapLibre の線として地形に沿わせ、ないときは deck.gl でジオイド面の上に描きます。                                                      |
| 色の範囲・線の間隔        | 画面上に格子状に取った地点の N の最小・最大から決めます。                                                                                                                                                                                               |
| 地点クリック・断面図      | 地点ごとに、ズーム 4 のタイルを双一次補間して N を求め、同じ地点の H と合わせて h = H + N を出します。                                                                                                                                                  |

deck.gl のレイヤ (ジオイド面・等値線) は MapLibre の描画に組み込んで重ねます。MapLibre の globe 表示は視点の中心を高さ 0 のまま描くため、deck.gl にも画面中心の地形の高さを使わせないようにしています (`globe-view.ts`)。

## 構成

| パス                          | 内容                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `src/`                        | ビューア (SvelteKit + MapLibre GL JS + deck.gl)                                 |
| `src/routes/+page.svelte`     | 地図 (globe・地形・背景地図) と操作パネル                                       |
| `src/lib/sources.ts`          | Mapterhorn のタイルとジオイドタイルの読み込み・合成                             |
| `src/lib/ground.worker.ts`    | 地表面タイル (H + N) をメインスレッドの外で合成する Worker                      |
| `src/lib/layers.ts`           | ジオイド面・等ジオイド高線を描く deck.gl のレイヤ                               |
| `src/lib/globe-view.ts`       | 地形があっても MapLibre の globe 表示とずれない deck.gl のビュー                |
| `src/lib/contours.ts`         | 等値線の計算 (マーチングスクエア法)                                             |
| `src/lib/profile.ts`          | 断面の計算 (大円上の点・距離・目盛り)                                           |
| `src/lib/ProfileChart.svelte` | 断面図                                                                          |
| `src/service-worker/`         | アプリ本体をキャッシュするサービスワーカー (PWA)                                |
| `static/manifest.webmanifest` | PWA のマニフェスト                                                              |
| `geoid/`                      | EGM2008 グリッドを Terrarium エンコードの PMTiles に変換するスクリプト (Python) |
| `.github/workflows/ci.yml`    | lint・テスト・ジオイドタイル生成・GitHub Pages への配信                         |

ジオイドタイル (`static/data/egm2008.pmtiles`、約 24 MB) は生成物なのでリポジトリには含めません。CI で生成し、ビルド結果と一緒に GitHub Pages で配信します。

## 開発

必要なもの: Node.js 24 (`.node-version`)、pnpm、[uv](https://docs.astral.sh/uv/)

```sh
# ジオイドタイルの生成 (初回のみ、1 分弱)
cd geoid
curl -fsSL -o data/us_nga_egm08_25.tif --create-dirs https://cdn.proj.org/us_nga_egm08_25.tif
uv run python build_tiles.py data/us_nga_egm08_25.tif ../static/data/egm2008.pmtiles
cd ..

# ビューア
pnpm install
pnpm dev
```

| コマンド                    | 内容                                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm format` | Prettier + ESLint                                                          |
| `pnpm check`                | 型チェック (svelte-check)                                                  |
| `pnpm test`                 | ユニットテスト (Vitest)                                                    |
| `pnpm build`                | 静的サイトを `build/` に出力。`BASE_PATH=/<リポジトリ名>` で配信パスを指定 |
| `cd geoid && uv run pytest` | ジオイドタイル生成スクリプトのテスト                                       |

## GitHub Pages での公開

リポジトリの Settings → Pages → Source を **GitHub Actions** にすると、`main` への push で自動的に配信されます。

## データの出典

- 地形: [© Mapterhorn](https://mapterhorn.com/attribution) (各データソースのライセンスに従います。日本は国土地理院の基盤地図情報 数値標高モデル)
- ジオイド: EGM2008 (NGA)。[PROJ-data](https://github.com/OSGeo/PROJ-data) が配布する `us_nga_egm08_25.tif` を使用
- 背景地図: [OpenFreeMap](https://openfreemap.org/) ([© OpenMapTiles](https://www.openmaptiles.org/)、[© OpenStreetMap contributors](https://www.openstreetmap.org/copyright))

## ライセンス

[MIT](LICENSE)
