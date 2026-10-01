// wrangler の rules で文字列として読み込むファイル
declare module "*.html" {
  const content: string;
  export default content;
}
declare module "*.embed.js" {
  const content: string;
  export default content;
}
