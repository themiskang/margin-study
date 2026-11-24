const identity = [1, 0, 0, 1, 0, 0];
const multiply = ([a, b, c, d, e, f], [g, h, i, j, k, l]) =>
  [a*g + c*h, b*g + d*h, a*i + c*j, b*i + d*j, a*k + c*l + e, b*k + d*l + f];
const apply = ([a, b, c, d, e, f], [x, y]) => [a*x + c*y + e, b*x + d*y + f];
const hexColor = components => "#" + components.map(value => Math.round(value * 255).toString(16).padStart(2, "0")).join("");
const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const ignored = new Set(["w", "J", "j", "M", "d", "i", "ri", "W", "W*"]);

export async function readPagePaint(pdf, bytes) {
  const { PDFDocument, PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } = pdf;
  const doc = await PDFDocument.load(bytes);
  if (doc.getPageCount() !== 1) throw new Error(`Fixture expected one page, got ${doc.getPageCount()}`);
  const { node } = doc.getPage(0);
  const name = value => PDFName.of(value);
  const resources = node.Resources();
  const graphics = resources?.lookupMaybe(name("ExtGState"), PDFDict);
  const objects = resources?.lookupMaybe(name("XObject"), PDFDict);
  const contents = node.Contents();
  const streams = contents instanceof PDFArray
    ? Array.from({ length: contents.size() }, (_, index) => contents.lookup(index, PDFRawStream))
    : contents ? [contents] : [];
  const stack = [];
  const paints = [];
  let state = { matrix: identity, stroke: "#000000", fill: "#000000", CA: null, ca: null, resource: null };
  let points = [];

  for (const [index, stream] of streams.entries()) {
    if (!(stream instanceof PDFRawStream)) throw new Error(`Expected a raw stream at page /Contents[${index}]`);
    const text = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
    let operands = [];
    for (const token of text.matchAll(/%[^\r\n]*|\[[^\]]*\]|\/[^\s<>\[\]()/]+|[^\s<>\[\]()/]+/g)) {
      const value = token[0];
      if (value.startsWith("%")) continue;
      if (value.startsWith("/") || value.startsWith("[") || numeric.test(value)) {
        operands.push(numeric.test(value) ? Number(value) : value);
        continue;
      }
      const location = `page 1 Contents[${index}] byte ${token.index}`;
      const add = kind => paints.push({
        kind, op: value, location, matrix: [...state.matrix], points: points.map(pair => [...pair]),
        color: kind === "stroke" ? state.stroke : state.fill,
        ca: state.ca, CA: state.CA, resource: state.resource,
      });
      switch (value) {
        case "q": stack.push({ ...state }); break;
        case "Q":
          if (!stack.length) throw new Error(`Unbalanced Q at ${location}`);
          state = stack.pop();
          break;
        case "cm": state.matrix = multiply(state.matrix, operands); break;
        case "gs": {
          const dictionary = graphics?.lookupMaybe(name(operands[0].slice(1)), PDFDict);
          if (!dictionary) throw new Error(`Unresolved ExtGState ${operands[0]} at ${location}`);
          state.resource = operands[0];
          for (const key of ["ca", "CA"]) {
            const alpha = dictionary.lookupMaybe(name(key), PDFNumber);
            if (alpha) state[key] = alpha.asNumber();
          }
          break;
        }
        case "RG": state.stroke = hexColor(operands); break;
        case "rg": state.fill = hexColor(operands); break;
        case "G": state.stroke = hexColor(Array(3).fill(operands[0])); break;
        case "g": state.fill = hexColor(Array(3).fill(operands[0])); break;
        case "m": case "l":
          points.push(apply(state.matrix, operands));
          break;
        case "c": case "v": case "y":
          for (let offset = 0; offset < operands.length; offset += 2) {
            points.push(apply(state.matrix, operands.slice(offset, offset + 2)));
          }
          break;
        case "re": {
          const [left, bottom, w, h] = operands;
          points.push(...[[left, bottom], [left + w, bottom], [left + w, bottom + h], [left, bottom + h]]
            .map(point => apply(state.matrix, point)));
          break;
        }
        case "S": case "s": add("stroke"); points = []; break;
        case "F": case "f": case "f*": add("fill"); points = []; break;
        case "B": case "B*": case "b": case "b*":
          add("fill"); add("stroke"); points = []; break;
        case "n": points = []; break;
        case "h": break;
        case "Do": {
          const object = objects?.lookupMaybe(name(operands[0].slice(1)), PDFRawStream);
          if (object?.dict.lookupMaybe(name("Subtype"), PDFName)?.toString() !== "/Image") {
            throw new Error(`Expected an image XObject at ${location}, got ${operands[0]}`);
          }
          add("image");
          break;
        }
        default:
          if (!ignored.has(value)) throw new Error(`Unsupported PDF operator ${value} at ${location}`);
      }
      operands = [];
    }
    if (operands.length) throw new Error(`Dangling operands at end of /Contents[${index}]`);
  }
  if (stack.length) throw new Error("Unbalanced graphics-state stack");
  return paints;
}

export function imagePaintsById(annotations, paints) {
  const byLeft = new Map(annotations.map(annotation => [annotation.rects[0].x, annotation.id]));
  return paints.filter(item => item.kind === "image").map(item => ({
    id: byLeft.get(Math.round(item.matrix[4])) ?? `unknown-image-at-${item.matrix[4]}`,
    alpha: item.ca, location: item.location,
  }));
}
