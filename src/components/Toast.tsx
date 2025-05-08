import React, { useEffect } from "react";
import { CheckCircle, XCircle, AlertTriangle, X } from "lucide-react";

export default function Toast({ message, type = "success", onClose, duration = 3000 }: { message?: string, type?: "success" | "error" | "warning", onClose?: () => void, duration?: number }) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        if (onClose) onClose();
      }, duration);
      
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-green-500" />,
    error: <XCircle className="w-5 h-5 text-red-500" />,
    warning: <AlertTriangle className="w-5 h-5 text-yellow-500" />
  };

  const bgColors = {
    success: "bg-white border-l-4 border-l-green-500",
    error: "bg-white border-l-4 border-l-red-500",
    warning: "bg-white border-l-4 border-l-yellow-500"
  };

  console.log('message', message);

  return (
    <div className="fixed top-4 right-4 z-50 animate-fade-in">
      <div className={`p-4 rounded-lg shadow-lg ${bgColors[type]} flex items-center max-w-md`}>
        <div className="mr-3">
          {icons[type]}
        </div>
        <div className="flex-1 text-sm font-medium text-black">
          {message}
        </div>
        <button 
          onClick={onClose}
          className="ml-3 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}