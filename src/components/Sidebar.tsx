import { useState } from 'react';
import { Search, Briefcase, Phone, Settings, ChevronsLeft, ChevronsRight } from 'lucide-react';

const sidebarItems = [
  { title: 'Results', icon: <Search size={24} /> },
  { title: 'Business Finder', icon: <Briefcase size={24} /> },
  { title: 'Contact Finder', icon: <Phone size={24} /> },
  { title: 'Settings', icon: <Settings size={24} /> },
];

export default function Sidebar({ setActivePage }: { setActivePage: (page: string) => void }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true); // Start with sidebar open
  const [activePage, setActivePageState] = useState<string>('Results');

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  const handleNavigation = (page: string) => {
    setActivePageState(page);
    setActivePage(page); // Pass the page to the parent component (Home)
  };

  return (
    <div className={`flex ${isSidebarOpen ? 'w-80' : 'w-20'} transition-width duration-300 bg-darkBlue text-white h-screen`}>
      {/* Sidebar Content */}
      <div className={`flex flex-col w-full ${isSidebarOpen ? 'p-6' : 'p-3'}`}>
        {/* App Name & Arrow Toggle */}
        <div className="flex items-center justify-between">

          {isSidebarOpen && <div className='flex items-center gap-4'>
                              <img src="/Risorsa_7c.svg" alt="Logo" className="w-8 h-8" />
                              <h1 className="text-2xl font-bold">Lead Extractor</h1>
                            </div>}
          <button
            onClick={toggleSidebar}
            className="text-white focus:outline-none hover:cursor-pointer"
            aria-label="Toggle Sidebar"
          >
            {isSidebarOpen ? <ChevronsLeft size={24} /> : <ChevronsRight size={24} />}
          </button>
        </div>

        {/* Sidebar Navigation */}
        <nav className="mt-8 flex flex-col space-y-4">
          {sidebarItems.map((item) => (
            <button
              key={item.title}
              onClick={() => handleNavigation(item.title)}
              className={`flex items-center space-x-4 p-3 rounded-lg hover:bg-gray-800 hover:text-sky-400 hover:cursor-pointer ${
                activePage === item.title ? 'bg-gray-800 text-sky-400' : ''
              }`}
            >
              {item.icon}
              {isSidebarOpen && <span>{item.title}</span>}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
