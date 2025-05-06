"use client";
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/supabaseClient';
import type { Database } from '@/types/supabase'; // path may vary

type TestRow = Database['public']['Tables']['test']['Row'];

export default function Home() {
  const [data, setData] = useState<TestRow[]>([]);

  useEffect(() => {
    const fetchTestData = async () => {
      const { data, error } = await supabase
        .from('test')
        .select('*');
      if (error) console.error('Error fetching data:', error);
      else setData(data);
    };

    fetchTestData();
  }, []);

  return (
    <div>
      <h1>Supabase Test Data</h1>
      <ul>
        {data.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </div>
  );
}
