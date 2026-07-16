import { getAddon } from "../utils/global";

const {
  outlineToMarkdown,
  outlineToHtml,
  getPdfOutline,
  getPdfHeadings,
  resolvePdfAttachment,
} = getAddon().api.note;

describe("PDF Outline", function () {
  describe("api.note.outlineToMarkdown (pure)", function () {
    it("maps top-level outline entries to ## (H2)", function () {
      // Given a 3-chapter outline (no nesting)
      const outline = [
        { title: "Introduction", level: 1, children: [] },
        { title: "Methods", level: 1, children: [] },
        { title: "Results", level: 1, children: [] },
      ];
      // When rendered with the default start level
      const md = outlineToMarkdown(outline);
      // Then each chapter is an H2 (# belongs to the note title), with a blank
      // line after each so there is room to take notes underneath.
      assert.equal(md, "## Introduction\n\n## Methods\n\n## Results\n");
    });

    it("descends one heading level per outline depth", function () {
      // Given a nested outline: chapter -> section -> subsection
      const outline = [
        {
          title: "Chapter",
          level: 1,
          children: [
            {
              title: "Section",
              level: 2,
              children: [{ title: "Subsection", level: 3, children: [] }],
            },
          ],
        },
      ];
      // When rendered
      const md = outlineToMarkdown(outline);
      // Then depths map to ##, ###, ####, each followed by a blank line
      assert.equal(md, "## Chapter\n\n### Section\n\n#### Subsection\n");
    });

    it("caps the heading level at ###### (H6) for deeply nested outlines", function () {
      // Given an outline nested 7 levels deep
      const deep = (title: string, level: number): any => ({
        title,
        level,
        children: level < 7 ? [deep(`L${level + 1}`, level + 1)] : [],
      });
      const outline = [deep("L1", 1)];
      // When rendered (level 1 -> ##, so level 6 -> ####### which must cap at ######)
      const md = outlineToMarkdown(outline);
      // Then no heading exceeds H6 (seven # would be invalid)
      assert.notInclude(md, "#######");
      assert.include(md, "###### L6");
    });

    it("inserts chapter titles verbatim", function () {
      // Given an outline whose title contains punctuation characters
      const outline = [
        { title: "3.2 Results & Discussion", level: 1, children: [] },
      ];
      // When rendered
      const md = outlineToMarkdown(outline);
      // Then the title appears verbatim after the heading marker
      assert.equal(md, "## 3.2 Results & Discussion\n");
    });

    it("strips control and zero-width characters from titles", function () {
      // Given an outline whose title carries a NUL, a BOM, and a zero-width space
      const outline = [
        {
          title: "\u0000Intro\u200Bduction\uFEFF",
          level: 1,
          children: [],
        },
      ];
      // When rendered
      const md = outlineToMarkdown(outline);
      // Then the junk characters are gone
      assert.equal(md, "## Introduction\n");
    });

    it("renders HTML headings with note space for the rich-text editor", function () {
      const outline = [
        { title: "A", level: 1, children: [] },
        { title: "B", level: 1, children: [] },
      ];
      const html = outlineToHtml(outline);
      assert.equal(html, "<h2>A</h2><p></p><h2>B</h2><p></p>");
    });

    it("returns an empty string for an empty outline", function () {
      assert.equal(outlineToMarkdown([]), "");
    });

    it("honours a custom start level", function () {
      const outline = [{ title: "A", level: 1, children: [] }];
      assert.equal(outlineToMarkdown(outline, 3), "### A\n");
    });
  });

  describe("api surface", function () {
    it("exposes the PDF outline functions on addon.api.note", function () {
      assert.isFunction(outlineToMarkdown);
      assert.isFunction(outlineToHtml);
      assert.isFunction(getPdfOutline);
      assert.isFunction(getPdfHeadings);
      assert.isFunction(resolvePdfAttachment);
    });
  });

  describe("api.note.getPdfHeadings (integration)", function () {
    it("returns Markdown headings for a library item that has a PDF with an outline", async function () {
      // Given the first library item with a PDF attachment, if any
      const items = Zotero.Items.getAll(Zotero.Libraries.userLibraryID, false);
      const withPdf = items.find((it) => !it.isNote() && !it.isAttachment());
      if (!withPdf) {
        this.skip();
      }
      const attachment = await resolvePdfAttachment(withPdf);
      if (!attachment) {
        this.skip();
      }
      // When asking for headings
      const headings = await getPdfHeadings(withPdf);
      // Then it returns a Markdown string (possibly empty when the PDF has no outline)
      assert.isString(headings);
    });
  });
});
