import { Route, Routes } from 'react-router'

import { WalletProvider } from '@/components/layout/WalletProvider'
import { AuctionRoomRoute } from '@/routes/AuctionRoomRoute'
import { AuctionsRoute } from '@/routes/AuctionsRoute'
import { CreateAuctionRoute } from '@/routes/CreateAuctionRoute'
import { SpecimenRoute } from '@/routes/SpecimenRoute'

// Route table only; screens live in src/routes/. The specimen stays
// reachable for theme regression checks against the hi-fi.
function App() {
  return (
    <WalletProvider>
      <Routes>
        <Route path="/" element={<AuctionsRoute />} />
        <Route path="/auction/:auctionId" element={<AuctionRoomRoute />} />
        <Route path="/create" element={<CreateAuctionRoute />} />
        <Route path="/specimen" element={<SpecimenRoute />} />
      </Routes>
    </WalletProvider>
  )
}

export default App
