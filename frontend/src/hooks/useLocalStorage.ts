import { useState, useEffect } from "react";

function readStoredValue<T>(key: string, initialValue: T): T {
  try {
    const item = window.localStorage.getItem(key);
    return item ? JSON.parse(item) : initialValue;
  } catch (error) {
    console.warn(`Error reading localStorage key "${key}":`, error);
    return initialValue;
  }
}

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
  // O valor anda junto da chave de onde foi lido. Sem isso, no render em que a chave muda
  // (troca de empresa) a tela via a chave nova com o valor da antiga, e qualquer efeito que
  // gravasse nesse render copiava a configuracao de um cliente para o outro.
  const [stored, setStored] = useState(() => ({ key, value: readStoredValue(key, initialValue) }));

  let current = stored;
  if (stored.key !== key) {
    current = { key, value: readStoredValue(key, initialValue) };
    setStored(current);
  }
  const storedValue = current.value;

  const setValue = (value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStored({ key, value: valueToStore });
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.warn(`Error setting localStorage key "${key}":`, error);
    }
  };

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        setStored({ key, value: JSON.parse(e.newValue) });
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [key]);

  return [storedValue, setValue];
}
