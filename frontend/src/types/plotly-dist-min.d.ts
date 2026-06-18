// Type declaration so plotly.js-dist-min re-exports the full plotly.js types.
// The dist-min bundle has the same API surface as the full package.
declare module 'plotly.js-dist-min' {
  export * from 'plotly.js'
  import Plotly from 'plotly.js'
  export default Plotly
}
