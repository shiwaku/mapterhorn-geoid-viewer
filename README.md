# Mapterhorn ジオイドビューア

[Mapterhorn](https://mapterhorn.com/) の地形と [EGM2008](https://earth-info.nga.mil/) のジオイド面を、地球楕円体 (WGS 84) を基準に 3D で重ねて表示するビューアです。

```
標高 H  =  楕円体高 h  −  ジオイド高 N
```

- **地表面**: 楕円体高 h = Mapterhorn の標高 H + EGM2008 のジオイド高 N
- **ジオイド面**: EGM2008 のジオイド高 N
- 地図をクリックすると、その地点の H・N・h を表示します。

## 注意

Mapterhorn の標高の基準は地域によって異なります。日本は国土地理院の DEM (東京湾平均海面) で、その他の多くの地域は Copernicus GLO-30 (EGM2008) です。ジオイド高はすべて EGM2008 なので、日本の楕円体高には数十 cm 程度の誤差が出ることがあります。

## 構成

| パス                       | 内容                                                                            |
| -------------------------- | ------------------------------------------------------------------------------- |
| `src/`                     | ビューア (SvelteKit + MapLibre GL JS + deck.gl)                                 |
| `src/lib/sources.ts`       | Mapterhorn のタイルとジオイドタイルの読み込み・合成                             |
| `src/lib/ground.worker.ts` | 地表面タイル (H + N) をメインスレッドの外で合成する Worker                      |
| `src/lib/layers.ts`        | deck.gl の TerrainLayer (地表面・ジオイド面)                                    |
| `geoid/`                   | EGM2008 グリッドを Terrarium エンコードの PMTiles に変換するスクリプト (Python) |
| `.github/workflows/ci.yml` | lint・テスト・ジオイドタイル生成・GitHub Pages への配信                         |

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
- 地図: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright)

## ライセンス

[MIT](LICENSE)
