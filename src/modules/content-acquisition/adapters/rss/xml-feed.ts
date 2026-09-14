import { SaxesParser } from "saxes";

import { ContentSourceAdapterError } from "../content-source-adapter";

export type XmlFeedNode = Readonly<{
  name: string;
  attributes: Record<string, string>;
  text: string;
  children: XmlFeedNode[];
}>;

export function xmlLocalName(value: string): string {
  return value.toLowerCase().split(":").at(-1) ?? value.toLowerCase();
}

export function xmlChildren(node: XmlFeedNode, name: string): XmlFeedNode[] {
  return node.children.filter((child) => xmlLocalName(child.name) === name.toLowerCase());
}

export function xmlFirst(node: XmlFeedNode, ...names: string[]): XmlFeedNode | null {
  for (const name of names) {
    const match = xmlChildren(node, name)[0];
    if (match) return match;
  }
  return null;
}

export function xmlText(node: XmlFeedNode | null | undefined): string {
  if (!node) return "";
  return `${node.text} ${node.children.map((child) => xmlText(child)).join(" ")}`.replace(/\s+/gu, " ").trim();
}

export function parseXmlFeed(xml: string): XmlFeedNode {
  const root = { name: "#document", attributes: {}, text: "", children: [] } as {
    name: string;
    attributes: Record<string, string>;
    text: string;
    children: XmlFeedNode[];
  };
  const stack = [root] as Array<{
    name: string;
    attributes: Record<string, string>;
    text: string;
    children: XmlFeedNode[];
  }>;
  const parser = new SaxesParser({ xmlns: false });
  let parseError: Error | null = null;
  parser.on("doctype", () => {
    parseError = new Error("Document type declarations are not allowed in feeds.");
  });
  parser.on("error", (error) => {
    parseError = error;
  });
  parser.on("opentag", (tag) => {
    const node = {
      name: tag.name,
      attributes: Object.fromEntries(
        Object.entries(tag.attributes).map(([key, value]) => [key.toLowerCase(), String(value)]),
      ),
      text: "",
      children: [],
    };
    stack.at(-1)!.children.push(node);
    stack.push(node);
  });
  parser.on("text", (value) => {
    stack.at(-1)!.text += value;
  });
  parser.on("cdata", (value) => {
    stack.at(-1)!.text += value;
  });
  parser.on("closetag", () => {
    if (stack.length > 1) stack.pop();
  });
  try {
    parser.write(xml).close();
  } catch (error) {
    parseError = error instanceof Error ? error : new Error("Feed XML is invalid.");
  }
  if (parseError) {
    throw new ContentSourceAdapterError(`Feed XML is invalid: ${parseError.message}`, false);
  }
  return root;
}

export function xmlFeedEntries(document: XmlFeedNode): XmlFeedNode[] {
  const queue = [...document.children];
  const result: XmlFeedNode[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    const name = xmlLocalName(node.name);
    if (name === "item" || name === "entry") result.push(node);
    else queue.push(...node.children);
  }
  return result;
}

export function xmlFindFirst(document: XmlFeedNode, name: string): XmlFeedNode | null {
  const queue = [...document.children];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (xmlLocalName(node.name) === name.toLowerCase()) return node;
    queue.push(...node.children);
  }
  return null;
}
