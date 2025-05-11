"use client";
import { useState } from 'react';
import Results from '../components/Results';
import BusinessFinder from '../components/BusinessFinder';
import ContactFinder from '../components/ContactFinder';
import Settings from '../components/Settings';
import Sidebar from '../components/Sidebar';

export default function Home() {
  const [activePage, setActivePage] = useState<string>('Results');

  const renderActivePage = () => {
    switch (activePage) {
      case 'Results':
        return <Results />;
      case 'Business Finder':
        return <BusinessFinder />;
      case 'Contact Finder':
        return <ContactFinder />;
      case 'Settings':
        return <Settings />;
      default:
        return <Results />;
    }
  };

  return (
    <div className="flex h-screen">
      <Sidebar setActivePage={setActivePage} />
      <div className="flex-1 p-8 bg-white overflow-y-auto">
        {renderActivePage()}
      </div>
    </div>
  );
}
