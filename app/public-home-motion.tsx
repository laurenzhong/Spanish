"use client";

import { useEffect, useRef, useState } from "react";

export default function PublicHomeMotion() {
  const heroRef = useRef<HTMLDivElement>(null);
  const [isDocumentVisible, setIsDocumentVisible] = useState(true);
  const [isHeroVisible, setIsHeroVisible] = useState(true);

  useEffect(() => {
    const onVisibilityChange = () => setIsDocumentVisible(document.visibilityState === "visible");
    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!heroRef.current || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => setIsHeroVisible(entry.isIntersecting), { threshold: 0.05 });
    observer.observe(heroRef.current);
    return () => observer.disconnect();
  }, []);

  return <div ref={heroRef} className="landing-hero__grid" aria-hidden="true" data-paused={!isDocumentVisible || !isHeroVisible ? "true" : "false"} />;
}
