import React from "react";

interface ToastProps {
  message: string;
  type?: 'error' | 'success';
  onClose: () => void;
}

export default function Toast({ message, type = 'error', onClose }: ToastProps) {
  const bgColor = type === 'error' ? 'bg-red-500' : 'bg-green-500';
  
  return (
    <div className="fixed top-4 right-4 z-50">
      <div className={`${bgColor} text-white px-6 py-3 rounded-lg shadow-lg flex items-center justify-between`}>
        <span>{message}</span>
        <button 
          onClick={onClose}
          className="ml-4 text-white hover:text-gray-200"
        >
          ×
        </button>
      </div>
    </div>
  );
}