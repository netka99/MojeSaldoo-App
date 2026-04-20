import { Button } from './components/ui/Button'
import { Input } from './components/ui/Input'
import { Card } from './components/ui/Card'

function App() {
  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Buttons Test */}
        <Card title="Przyciski" subtitle="Różne warianty i rozmiary">
          <div className="space-y-4">
            <div className="flex gap-4">
              <Button variant="primary">Wszystkie</Button>
              <Button variant="secondary">Dodaj</Button>
              <Button variant="accent">Zwróć</Button>
              <Button variant="ghost">Anuluj</Button>
            </div>
            <div className="flex gap-4">
              <Button variant="primary" isLoading>Ładowanie...</Button>
              <Button variant="secondary" disabled>Wyłączony</Button>
            </div>
          </div>
        </Card>

        {/* Inputs Test */}
        <Card title="Pola formularza" subtitle="Input z różnymi stanami">
          <div className="space-y-4">
            <Input 
              label="Email" 
              type="email" 
              placeholder="jan.kowalski@example.com"
              helperText="Wprowadź swój email"
            />
            <Input 
              label="Hasło" 
              type="password" 
              placeholder="••••••••"
            />
            <Input 
              label="Nieprawidłowe pole" 
              type="text" 
              error="To pole jest wymagane"
            />
          </div>
        </Card>

      </div>
    </div>
  )
}

export default App