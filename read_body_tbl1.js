const fs = require('fs');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');

const docxPath = "C:\\Users\\gustavo.beberaggi\\Downloads\\Formulario\\RG-02-IT-140.03-004_Asignacion_Traspaso_Devolucion_EQ_V5.docx";

fs.readFile(docxPath, function(err, data) {
    if (err) throw err;
    JSZip.loadAsync(data).then(async function(zip) {
        const docXmlText = await zip.file("word/document.xml").async("string");
        const doc = new DOMParser().parseFromString(docXmlText, 'text/xml');
        const tables = doc.getElementsByTagName('w:tbl');
        if (tables.length > 0) {
            console.log("TABLE 1 XML (first 1500 chars):");
            const xml = tables[0].toString();
            console.log(xml.substring(0, 2000));
        }
    }).catch(err => console.error(err));
});
