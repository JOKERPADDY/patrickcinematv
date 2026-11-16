import { useEffect, useState } from 'react'
import { Trophy, Flag, Circle, Flame } from 'lucide-react'
import { DEFAULT_SPORTS_CATEGORIES, sportsApi } from '../../api/sports'

interface SportsFiltersProps {
  selectedSport: string
  onSportChange: (sport: string) => void
}

export default function SportsFilters({ selectedSport, onSportChange }: SportsFiltersProps) {
  const [categories, setCategories] = useState<string[]>([...DEFAULT_SPORTS_CATEGORIES])

  useEffect(() => {
    let active = true
    sportsApi.getCategories()
      .then((availableCategories) => {
        if (active) setCategories(availableCategories)
      })
      .catch((error: unknown) => {
        console.error('Error fetching live sports categories:', error)
      })

    return () => {
      active = false
    }
  }, [])

  const iconForCategory = (category: string) => {
    if (category === 'racing') return Flag
    if (category === 'combat') return Flame
    if (category === 'basketball' || category === 'hockey' || category === 'baseball' || category === 'tennis') {
      return Circle
    }
    return Trophy
  }
  const sports = [
    { id: 'all', name: 'All Sports', icon: Trophy },
    ...categories.map((category) => ({
      id: category,
      name: category.charAt(0).toUpperCase() + category.slice(1),
      icon: iconForCategory(category),
    })),
  ]

  return (
    <div className="flex flex-wrap gap-2 sm:gap-3">
      {sports.map((sport) => {
        const Icon = sport.icon
        const isActive = selectedSport === sport.id
        
        return (
          <button
            key={sport.id}
            onClick={() => onSportChange(sport.id)}
            className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg font-medium text-sm transition-all duration-150 active:scale-95 ${
              isActive
                ? 'bg-primary text-white shadow-lg shadow-primary/30'
                : 'glass hover:bg-white/15 text-gray-300 hover:text-gray-100'
            }`}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="hidden sm:inline">{sport.name}</span>
            <span className="sm:hidden">{sport.name.split(' ')[0]}</span>
          </button>
        )
      })}
    </div>
  )
}
