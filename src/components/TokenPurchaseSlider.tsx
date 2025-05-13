import React, { useState, useEffect } from 'react';
import Button from './Button';

const TokenPurchaseSlider = () => {
  const TOKENS_PER_DOLLAR = 1000;
  const [tokenCount, setTokenCount] = useState(500);
  const [cost, setCost] = useState(0);
  
  useEffect(() => {
    setCost(tokenCount / TOKENS_PER_DOLLAR);
  }, [tokenCount]);
  
  return (
    <div> 
      <div className="mb-8">
        <div className="flex justify-end mb-2">
          <span className="text-lg font-medium text-sky-400">
            {tokenCount.toLocaleString()}
          </span>
        </div>
        
        <input
          type="range"
          min="100"
          max="100000"
          step="100"
          value={tokenCount}
          onChange={(e) => setTokenCount(parseInt(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
        
        <div className="flex justify-between mt-2">
          <span className="text-xs text-gray-500">100</span>
          <span className="text-xs text-gray-500">100,000</span>
        </div>
      </div>
      
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6">
        <div className="mb-4 md:mb-0">
          <p className="text-gray-700">Total Cost:</p>
          <p className="text-2xl font-semibold text-gray-900 py-2">${cost.toFixed(2)}</p>
          <p className="text-xs text-gray-500">Rate: {TOKENS_PER_DOLLAR} tokens per $1.00</p>
        </div>
        
        <Button
        text="Purchase Tokens"
        onClick={() => console.log(`Purchase ${tokenCount} tokens for $${cost.toFixed(2)}`)}
        />
      </div>
    </div>
  );
};

export default TokenPurchaseSlider;