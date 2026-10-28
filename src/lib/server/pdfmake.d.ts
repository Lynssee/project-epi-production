// Ambient module declaration for `pdfmake`'s Node entry point (package.json `main` =
// src/printer.js, a constructable PdfPrinter class) — NOT the same shape as the
// official @types/pdfmake package (that types the browser bundle API instead, which
// caused "This expression is not constructable" when installed). `any` here matches
// runtime reality without pretending to a precise type surface we don't need.
declare module 'pdfmake' {
	const PdfPrinter: any;
	export default PdfPrinter;
}
