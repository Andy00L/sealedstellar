import { Route, Routes } from 'react-router'

import { SpecimenRoute } from '@/routes/SpecimenRoute'

// Route table only; screens live in src/routes/. The specimen sits at the
// root until milestone 2 lands the auctions list as the home screen.
function App() {
  return (
    <Routes>
      <Route path="/" element={<SpecimenRoute />} />
    </Routes>
  )
}

export default App
