import React from "react";

interface ToastProps {
  message: string;
  type?: 'error' | 'success';
}

export default function Toast({ message, type = 'error' }: ToastProps) {
  const bgColor = type === 'error' ? 'bg-red-500' : 'bg-green-500';
  
  return (
    <div className="fixed top-4 right-4 z-50">
      <div className={`${bgColor} text-white px-6 py-3 rounded-lg shadow-lg flex items-center`}>
        <span>{message}</span>
      </div>
    </div>
  );
}