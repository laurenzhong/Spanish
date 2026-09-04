"use client";

import Image from "next/image";
import { useSyncExternalStore } from "react";

export type ChatBubbleStyle = "pink-frog" | "dog-long";

export const CHAT_BUBBLE_STYLE_STORAGE_KEY = "sueno-chat-bubble-style";
export const CHAT_BUBBLE_STYLE_UPDATED_EVENT = "chat-bubble-style-updated";

export const CHAT_BUBBLE_STYLE_OPTIONS: ReadonlyArray<Readonly<{
  id: ChatBubbleStyle;
  label: string;
  description: string;
}>> = [
  { id: "dog-long", label: "深色狗狗", description: "棕色长身狗狗" },
  { id: "pink-frog", label: "浅色青蛙", description: "粉色气泡与贴纸" },
];

const validStyles = new Set<ChatBubbleStyle>(CHAT_BUBBLE_STYLE_OPTIONS.map((option) => option.id));

function subscribeToChatBubbleStyle(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handleChange = () => onStoreChange();
  window.addEventListener(CHAT_BUBBLE_STYLE_UPDATED_EVENT, handleChange);
  window.addEventListener("storage", handleChange);
  return () => {
    window.removeEventListener(CHAT_BUBBLE_STYLE_UPDATED_EVENT, handleChange);
    window.removeEventListener("storage", handleChange);
  };
}

function getServerChatBubbleStyle(): ChatBubbleStyle {
  return "dog-long";
}

export function readChatBubbleStyle(): ChatBubbleStyle {
  if (typeof window === "undefined") return "dog-long";
  try {
    const value = window.localStorage.getItem(CHAT_BUBBLE_STYLE_STORAGE_KEY);
    return value && validStyles.has(value as ChatBubbleStyle) ? value as ChatBubbleStyle : "dog-long";
  } catch {
    return "dog-long";
  }
}

export function saveChatBubbleStyle(style: ChatBubbleStyle): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(CHAT_BUBBLE_STYLE_STORAGE_KEY, style);
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent(CHAT_BUBBLE_STYLE_UPDATED_EVENT, { detail: style }));
  return true;
}

export function useChatBubbleStyle(): ChatBubbleStyle {
  return useSyncExternalStore(subscribeToChatBubbleStyle, readChatBubbleStyle, getServerChatBubbleStyle);
}

type BubbleArtProps = Readonly<{ text: string; style: ChatBubbleStyle }>;

type DogFrame = "compact" | "medium" | "long";

const DOG_FRAMES: Readonly<Record<DogFrame, Readonly<{
  src: string;
  width: number;
  height: number;
}>>> = {
  compact: { src: "/chat-bubbles/dog-compact-frame.png", width: 225, height: 145 },
  medium: { src: "/chat-bubbles/dog-third-frame.png", width: 555, height: 145 },
  long: { src: "/chat-bubbles/dog-long-frame.png", width: 650, height: 145 },
};

function selectDogFrame(text: string): DogFrame {
  const characterCount = Array.from(text.trim().replace(/\s+/g, " ") || "…").length;
  if (characterCount <= 18) return "compact";
  if (characterCount <= 56) return "medium";
  return "long";
}

function BubbleText({ text }: Readonly<{ text: string }>) {
  return <span className="conversation-message__text conversation-art-bubble__text">{text || "…"}</span>;
}

export function ChatBubbleArt({ text, style }: BubbleArtProps) {
  if (style === "pink-frog") {
    return (
      <div className="conversation-art-bubble conversation-art-bubble--pink">
        <Image className="conversation-art-bubble__heart" src="/chat-bubbles/heart-clean.png" alt="" aria-hidden="true" width={48} height={52} loading="eager" />
        <span className="conversation-art-bubble__text-layer"><BubbleText text={text} /></span>
        <Image className="conversation-art-bubble__frog" src="/chat-bubbles/frog-clean.png" alt="" aria-hidden="true" width={75} height={90} loading="eager" />
      </div>
    );
  }
  const dogFrame = selectDogFrame(text);
  const dogAsset = DOG_FRAMES[dogFrame];
  return (
    <div
      className={`conversation-art-bubble conversation-art-bubble--dog conversation-art-bubble--dog-${dogFrame}`}
      data-dog-frame={dogFrame}
    >
      <Image
        className="conversation-art-bubble__dog-art"
        src={dogAsset.src}
        alt=""
        aria-hidden="true"
        width={dogAsset.width}
        height={dogAsset.height}
        loading="eager"
        unoptimized
        sizes="(max-width: 640px) 82vw, 430px"
      />
      <span className="conversation-art-bubble__text-layer"><BubbleText text={text} /></span>
    </div>
  );
}

export function ChatBubbleStyleSample({ style }: Readonly<{ style: ChatBubbleStyle }>) {
  return <ChatBubbleArt text={style === "pink-frog" ? "你好呀" : "¿Llegaste bien?"} style={style} />;
}
