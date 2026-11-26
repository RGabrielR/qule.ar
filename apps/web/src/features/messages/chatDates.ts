import { useEffect, useState } from "react";

export const chatDateFormat = new Intl.DateTimeFormat("es-AR", {
  day: "numeric", month: "long", year: "numeric",
});

export function chatDay(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function useChatToday() {
  const [today, setToday] = useState(() => chatDay(new Date()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function updateToday() {
      clearTimeout(timer);
      const now = new Date();
      setToday(chatDay(now));
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(updateToday, midnight.getTime() - now.getTime());
    }
    updateToday();
    document.addEventListener("visibilitychange", updateToday);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", updateToday);
    };
  }, []);

  return today;
}
