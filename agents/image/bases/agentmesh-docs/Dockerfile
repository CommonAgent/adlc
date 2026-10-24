# A base image for Agent Packages that declare the document tools: poppler's
# pdfinfo, pdftoppm, pdftohtml and pdffonts, and LibreOffice Impress and
# Writer without a desktop (soffice).
#
# 0.88.6-2 (2026-10-06, document-reader): LibreOffice Writer too. Impress
# alone cannot open a Word file ("source file could not be loaded"), so
# document-reader could neither read an old .doc nor draw a .docx into a PDF
# to find each section's page numbers. The build now also draws a one-page
# text document and reads it back.
#
# WHY THIS EXISTS. presentation-viewer (2026-10-05) reads a PDF's own words
# and pictures with poppler, renders each page to a PNG, and draws a
# PowerPoint file's slides into a PDF with LibreOffice so each slide has an
# image. No base had any of these, so it resolved to nothing, which is the rule
# working (12.4 rule 1: never substitute). This is the agentmesh base plus
# Debian's poppler-utils and LibreOffice Impress, and the fonts LibreOffice
# draws the common Office faces with (Carlito for Calibri, Caladea for Cambria,
# Liberation for Arial, Times New Roman and Courier New), so a slide drawn here
# keeps its line breaks. A face the deck asks for that is not here is drawn
# with another, and presentation-viewer names it in its report.
#
# It holds no key, no address, no account identifier and no package.
#
#   bash ../build-bases.sh agentmesh-docs <registry>/agentmesh-docs-base:<tag>
#
# The registry is a placeholder filled from the environment file (env/<name>.json
# gcp.registry) by build-bases.sh and ../../build-bases.mjs; built as written, FROM
# stops on it rather than quietly building on another environment's image.
ARG FROM_IMAGE={gcp.registry}/agentmesh-base:0.88.6
FROM ${FROM_IMAGE}

RUN set -eu ; \
    export DEBIAN_FRONTEND=noninteractive ; \
    apt-get update ; \
    apt-get install -y --no-install-recommends \
      poppler-utils \
      libreoffice-impress-nogui \
      libreoffice-writer-nogui \
      fonts-liberation2 \
      fonts-dejavu-core \
      fonts-crosextra-carlito \
      fonts-crosextra-caladea \
      ca-certificates ; \
    apt-get clean ; \
    rm -rf /var/lib/apt/lists/*

# Present is not working: draw a one-slide deck written here with LibreOffice,
# then read it with every poppler tool the catalogue claims, so a build whose
# office suite cannot draw a slide, or whose poppler cannot read the result,
# fails here and not on the first deck somebody sends.
RUN set -eu ; \
    command -v pdfinfo ; \
    command -v pdftoppm ; \
    command -v pdftohtml ; \
    command -v pdffonts ; \
    command -v soffice ; \
    mkdir -p /tmp/probe ; cd /tmp/probe ; \
    printf '%s' '<?xml version="1.0" encoding="UTF-8"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.presentation"><office:body><office:presentation><draw:page draw:name="one"><draw:frame svg:x="2cm" svg:y="2cm" svg:width="20cm" svg:height="3cm"><draw:text-box><text:p>Probe slide</text:p></draw:text-box></draw:frame></draw:page></office:presentation></office:body></office:document>' > probe.fodp ; \
    HOME=/tmp/probe soffice --headless --norestore --convert-to pdf --outdir /tmp/probe probe.fodp ; \
    pdfinfo probe.pdf | grep -q '^Pages: *1' ; \
    pdftoppm -png -scale-to 200 probe.pdf page ; ls page-1.png ; \
    pdftohtml -xml -q probe.pdf words ; grep -q 'Probe slide' words.xml ; \
    pdffonts probe.pdf ; \
    printf '%s' '<?xml version="1.0" encoding="UTF-8"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.text"><office:body><office:text><text:p>Probe page</text:p></office:text></office:body></office:document>' > page.fodt ; \
    HOME=/tmp/probe soffice --headless --norestore --convert-to docx --outdir /tmp/probe page.fodt ; \
    HOME=/tmp/probe soffice --headless --norestore --convert-to pdf --outdir /tmp/probe page.docx ; \
    pdftohtml -xml -q page.pdf pagewords ; grep -q 'Probe page' pagewords.xml ; \
    cd / ; rm -rf /tmp/probe
