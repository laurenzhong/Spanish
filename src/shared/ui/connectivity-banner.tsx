"use client";

import { useEffect, useState } from "react";

export function ConnectivityBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const updateStatus = () => setIsOffline(!window.navigator.onLine);

    updateStatus();
    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);

    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
    };
  }, []);

  if (!isOffline) {
    return null;
  }

  return (
    <div className="connectivity-banner" role="status">
      当前处于离线状态。已保存的页面仍可查看，联网后会继续同步。
    </div>
  );
}
